/**
 * collect.mjs —— 度量管线核心模块
 *
 * 职责：
 *   对单个 H5 页面执行"四产物"采集与度量：
 *     1. *.aria.yml        Playwright 无障碍树快照（纯结构，无几何）
 *     2. *.geometry.json   自采集的事实树（几何/排版/颜色/效果属性，供引擎消费）
 *     3. *.cdp.json        CDP DOMSnapshot 原始数据（对照用）
 *     4. *.report.txt      规则判定 + 分层渲染的文本报告（LLM 回流通路）
 *
 * 解耦说明：
 *   本模块不持有夹具清单、不解析命令行/环境变量、不负责汇总打印——
 *   这些"实验启动"职责全部在 src/run.mjs（启动器）中。
 *   外部用法：见 run.mjs；或编程式调用：
 *     import { chromium } from 'playwright';
 *     import { collectPage, VIEWPORT } from './collect.mjs';
 *     const browser = await chromium.launch();
 *     await collectPage(browser, { name, inputDir, outDir, cfg, echo });
 *
 * 依赖注入：cfg/echo 由启动器经 config.mjs loadConfig() 产出后传入，
 *   保证同一进程内多批采集共享同一份配置。
 */

import { writeFileSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runMetrics } from './metrics.mjs';
import { formatReport } from './format.mjs';

/** 移动端视口常量（375×812 逻辑像素，与夹具设计基准一致） */
export const VIEWPORT = { width: 375, height: 812 };

/**
 * COLLECT —— 注入页面执行的采集函数（序列化后在浏览器上下文运行）
 *
 * 输入：vw = { w, h } 上下文视口（来自启动器，而非 window.innerWidth——
 *        移动端模拟下 innerWidth 会被内容撑大，不能作溢出判定基准）
 * 输出：{ pageInfo, tree } 事实数据，字段与 rules/engine 消费面一一对应
 *
 * 注意：此函数在浏览器内执行，不能引用 Node 侧模块（color.mjs 等），
 *        颜色解析/合成逻辑以自包含副本形式内联于此。
 */
const COLLECT = (vw) => {
  /** 不参与度量树的元素（非渲染节点） */
  const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'BASE', 'HEAD']);
  /** 可交互元素选择器（TAP_TARGET / 反馈类规则的判定输入） */
  const INTERACTIVE = 'a,button,input,select,textarea,[role="button"],[contenteditable="true"]';

  /** 解析 computed color 字符串 "rgb(a)(r,g,b[,a])" → {r,g,b,a}；不匹配返回 null */
  const parseCs = (s) => {
    const m = s && s.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    if (p.length < 3 || p.slice(0, 3).some((v) => Number.isNaN(v))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };

  /** alpha 合成：前景 f 叠加到底色 b（标准 source-over 公式） */
  const blend = (f, b) => {
    if (!f || f.a <= 0) return [b[0], b[1], b[2]];
    const a = f.a;
    return [f.r * a + b[0] * (1 - a), f.g * a + b[1] * (1 - a), f.b * a + b[2] * (1 - a)];
  };

  /* ---- 页面级信息：视口基准 / 滚动尺寸 / body 底色 ---- */
  const scrollEl = document.scrollingElement || document.documentElement;
  const bodyOwn = parseCs(getComputedStyle(document.body).backgroundColor);
  const pageInfo = {
    viewport: vw,
    innerW: window.innerWidth,
    scrollWidth: scrollEl.scrollWidth,
    scrollHeight: scrollEl.scrollHeight,
    /** body 自身底色（树从 body.children 开始，body 底色需单独带回供面积归因补全） */
    bodyBg: bodyOwn && bodyOwn.a > 0 ? blend(bodyOwn, [255, 255, 255]).map((v) => Math.round(v)) : null
  };

  /** 数值保留两位小数（防亚像素抖动，判定层再决定取整时机） */
  const f2 = (n) => Math.round(n * 100) / 100;
  /** 直接文本摘要：压空白、截断到 40 字（树体积控制） */
  const clip = (s) => {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  };

  /** 解析 box-shadow → {y 偏移, blur, alpha, 层数}；none/不合法返回 null（L5 阴影类规则输入） */
  const parseShadow = (s) => {
    if (!s || s === 'none') return null;
    const px = [...s.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => parseFloat(m[1]));
    const alphas = [...s.matchAll(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\s*\)/g)].map((m) => (m[1] === undefined ? 1 : parseFloat(m[1])));
    if (px.length < 3) return null;
    return {
      y: px[1],
      blur: px[2],
      alpha: alphas.length ? Math.max(...alphas) : 0,
      layers: Math.max(1, Math.floor(px.length / 4))
    };
  };

  /** 解析 backdrop-filter 中的 blur 半径 px（毛玻璃类规则输入） */
  const parseBlur = (s) => {
    const m = s && s.match(/blur\(([\d.]+)px\)/i);
    return m ? parseFloat(m[1]) : 0;
  };

  /** 解析 transitionDuration "0.2s" → 毫秒数（动效类规则输入；UA 默认 0s 视为无动效） */
  const parseDur = (s) => {
    const m = s && s.match(/^([\d.]+)s/);
    return m ? parseFloat(m[1]) * 1000 : 0;
  };

  /** 字族首项归一化（FONT_FAMILY_BLOAT 判定输入，去除引号/统一小写） */
  const famFirst = (s) => (s ? s.split(',')[0].replace(/["']/g, '').trim().toLowerCase() : '');

  /**
   * walk —— 深度优先构建事实树
   * parentBg：父级有效背景（alpha 合成链，逐层向下传递）
   * 跳过：非渲染标签 / display:none / visibility:hidden
   * 零尺寸节点：自身不入树，子节点上提（hoist），避免树断裂
   */
  const walk = (el, parentBg) => {
    const out = [];
    for (const child of el.children) {
      if (SKIP.has(child.tagName)) continue;
      const cs = getComputedStyle(child);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const kids = walk(child, parentBg);
      const r = child.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        out.push(...kids);
        continue;
      }
      /* 有效背景/前景：自身背景 alpha>0 则叠加父级，否则继承父级；
         前景 color 同样叠加到有效背景上（半透明文字场景） */
      const own = parseCs(cs.backgroundColor);
      const bgOwn = !!own && own.a > 0;
      const bg = bgOwn ? blend(own, parentBg) : parentBg;
      const fgRaw = parseCs(cs.color);
      const fg = fgRaw ? blend(fgRaw, bg) : bg;
      const shadow = parseShadow(cs.boxShadow);
      const backBlur = parseBlur(cs.backdropFilter);
      const trMs = parseDur(cs.transitionDuration);
      /* 直接文本 = 元素自身的文本节点拼接（不含子孙，控制树内文本体积） */
      let text = '';
      for (const n of child.childNodes) if (n.nodeType === 3) text += n.textContent;
      out.push({
        tag: child.tagName.toLowerCase(),
        id: child.id || '',
        cls: child.classList.length ? Array.from(child.classList).slice(0, 2).join('.') : '',
        role: child.getAttribute('role') || '',
        text: clip(text),
        rect: { x: f2(r.x), y: f2(r.y), w: f2(r.width), h: f2(r.height) },
        pos: cs.position,
        interactive: child.matches(INTERACTIVE),
        textClip: child.scrollWidth > child.clientWidth + 1,
        fontSize: parseFloat(cs.fontSize) || null,
        lineHeight: cs.lineHeight === 'normal' ? null : f2(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)),
        radius: parseFloat(cs.borderTopLeftRadius) || 0,
        padding: parseFloat(cs.paddingTop) || 0,
        fg: fg.map((v) => Math.round(v)),
        bg: bg.map((v) => Math.round(v)),
        bgOwn,
        bgOwnAlpha: bgOwn ? own.a : 1,
        shadow,
        backBlur,
        trMs,
        trAll: trMs > 0 && cs.transitionProperty === 'all',
        ls: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0,
        fw: parseInt(cs.fontWeight, 10) || 400,
        ff: famFirst(cs.fontFamily),
        bw: parseFloat(cs.borderTopWidth) || 0,
        tdl: cs.textDecorationLine || 'none',
        children: kids
      });
    }
    return out;
  };

  /**
   * scanCssom —— 样式表伪类扫描（P1 反馈类规则的输入）
   * 统计 :hover / :focus(-visible) / outline 移除三类选择器；
   * 跨域/禁用样式表容错跳过；每类截断 50 条防膨胀。
   */
  const scanCssom = () => {
    const out = { hover: [], focus: [], outlineNone: [] };
    try {
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        if (!rules) continue;
        for (const r of rules) {
          const sel = r.selectorText || '';
          if (!sel) continue;
          if (/:hover\b/.test(sel)) out.hover.push(sel);
          if (/:focus-visible\b|:focus\b/.test(sel)) out.focus.push(sel);
          const st = r.style;
          if (st && (st.outlineStyle === 'none' || parseFloat(st.outlineWidth) === 0)) out.outlineNone.push(sel);
        }
      }
    } catch {}
    for (const k of Object.keys(out)) out[k] = out[k].slice(0, 50);
    return out;
  };

  return { pageInfo: { ...pageInfo, cssom: scanCssom() }, tree: walk(document.body, [255, 255, 255]) };
};

/**
 * collectPage —— 单页面完整采集流程（模块主入口）
 *
 * @param browser  已启动的 Playwright Browser 实例（由启动器管理生命周期）
 * @param opts
 *   - name      夹具名（不含扩展名，决定输入/输出文件名）
 *   - inputDir  输入目录（含 <name>.html）
 *   - outDir    输出目录（四产物落盘处，自动创建）
 *   - cfg       已合并的度量配置（config.mjs loadConfig().cfg）
 *   - echo      配置回显串（写入报告 Config: 行）
 * @returns { name, sizes, issues } 供启动器汇总
 */
export async function collectPage(browser, { name, inputDir, outDir, cfg, echo }) {
  mkdirSync(outDir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(join(inputDir, name + '.html')).href);

  /* 三路采集：无障碍树 / 事实树 / CDP 快照 */
  const aria = await page.ariaSnapshot();
  const geo = await page.evaluate(COLLECT, { w: VIEWPORT.width, h: VIEWPORT.height });
  const cdp = await ctx.newCDPSession(page);
  const snap = await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [], includeDOMRects: true });

  /* 判定与渲染：facts 构建会向 geo 节点挂 _ 前缀内部字段，
     落盘前以 replacer 剥除，保证 geometry.json 只含纯净事实 */
  const issues = runMetrics(geo, cfg);
  const report = formatReport(name, geo, issues, echo);
  const clean = JSON.parse(JSON.stringify(geo, (k, v) => (k.startsWith('_') ? undefined : v)));

  const files = {
    aria: join(outDir, name + '.aria.yml'),
    geo: join(outDir, name + '.geometry.json'),
    cdp: join(outDir, name + '.cdp.json'),
    report: join(outDir, name + '.report.txt')
  };
  writeFileSync(files.aria, aria, 'utf8');
  writeFileSync(files.geo, JSON.stringify(clean, null, 2), 'utf8');
  writeFileSync(files.cdp, JSON.stringify(snap), 'utf8');
  writeFileSync(files.report, report, 'utf8');

  const result = {
    name,
    sizes: {
      aria: statSync(files.aria).size,
      geo: statSync(files.geo).size,
      cdp: statSync(files.cdp).size,
      report: statSync(files.report).size
    },
    issues: issues.length
  };
  await ctx.close();
  return result;
}
