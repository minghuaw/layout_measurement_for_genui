/**
 * collect.mjs —— 度量管线核心模块（与实验夹具解耦）
 *
 * 职责：
 *   对单个 H5 页面执行采集与度量，双模式产出：
 *     工具模式（默认，fullArtifacts=false）：
 *       *.report.txt  规则判定 + 分层渲染的文本报告（LLM 回流通路，工具唯一产物）
 *     实验模式（fullArtifacts=true，供格式对比实验 / style_eval 等）：
 *       额外产出 *.aria.yml（无障碍树）、*.geometry.json（事实树）、*.cdp.json（DOMSnapshot）
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
  /** 图表/媒体容器选择器（VOID_BAND 空白带投影须计入其占位，避免把无文本内容区当空白带） */
  const MEDIA = 'canvas,img,video,iframe,svg,object,[data-echarts],[data-chart-section],.echarts';

  /** 解析 computed color 字符串 "rgb(a)(r,g,b[,a])" → {r,g,b,a}；不匹配返回 null */
  const parseCs = (s) => {
    const m = s && s.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    if (p.length < 3 || p.slice(0, 3).some((v) => Number.isNaN(v))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };

  /** 解析任意常见颜色字面量（#rgb/#rrggbb/#rrggbbaa / rgb(a)）→ {r,g,b,a}；否则 null */
  const parseCol = (s) => {
    if (!s) return null;
    const h = s.trim();
    if (h[0] === '#') {
      let x = h.slice(1);
      if (x.length === 3 || x.length === 4) x = [...x].map((c) => c + c).join('');
      if (x.length === 6) x += 'ff';
      if (!/^[0-9a-fA-F]{8}$/.test(x)) return null;
      return {
        r: parseInt(x.slice(0, 2), 16),
        g: parseInt(x.slice(2, 4), 16),
        b: parseInt(x.slice(4, 6), 16),
        a: parseInt(x.slice(6, 8), 16) / 255
      };
    }
    return parseCs(h);
  };

  /**
   * collectChartTextColors —— 从 data-echarts 配置 JSON 中抽取“文字性”颜色（textStyle / axisLabel /
   * nameTextStyle / label / name 语境下的 color 值）。图表颜色此前不进入任何规则（canvas/DOM 不可见、
   * 属性 JSON 未被解析），导致模型任意改动图表配色而无反馈；此字段使图表文字进入对比度测量。
   */
  const collectChartTextColors = (el) => {
    const raw = el.getAttribute('data-echarts');
    if (!raw) return null;
    let obj;
    try { obj = JSON.parse(raw); } catch { return null; }
    const out = [];
    const walk = (v, path, inText) => {
      if (v === null || v === undefined) return;
      if (typeof v === 'string') {
        if (!/^(#([0-9a-f]{3,8})|rgba?\(|transparent)/i.test(v)) return;
        if (v.toLowerCase() === 'transparent') return;
        if (inText) out.push(v);
        return;
      }
      if (Array.isArray(v)) {
        for (const it of v) walk(it, path, inText);
        return;
      }
      if (typeof v === 'object') {
        for (const k of Object.keys(v)) {
          const texty = inText || /textStyle|axisLabel|nameTextStyle|label|^name$/i.test(k);
          walk(v[k], path + '.' + k, texty);
        }
      }
    };
    walk(obj, '', false);
    return out.length ? out : null;
  };

  /**
   * chartTopRisk —— 图表顶部空间风险（y 轴最大值刻度/轴名被裁切的启发式）：
   *   只有显式 grid.containLabel=true 才算稳妥（让 ECharts 自动保留坐标轴标签空间）；
   *   仅给 grid.top 数值仍可能裁切（exp17 实测 top:60 仍裁）。
   * 返回 true/false；无 data-echarts 或解析失败返回 null。
   */
  const computeChartTopRisk = (el) => {
    const raw = el.getAttribute('data-echarts');
    if (!raw) return null;
    let obj;
    try { obj = JSON.parse(raw); } catch { return null; }
    if (!obj || typeof obj !== 'object') return null;
    const g = obj.grid;
    if (g && g.containLabel === true) return false;
    return true;
  };

  /**
   * collectChartDataColors —— 从 data-echarts 配置抽取"数据/线条"非文字颜色（series 下的
   *   color / lineStyle / itemStyle / areaStyle 等）。返回 { explicit, colors }：
   *   未显式设置系列色时 ECharts 使用默认色板（不受控、与页面强调色无关），
   *   这是图表"随机色"的来源；explicit=false 供 CHART_DATA_COLOR 判定。
   */
  const collectChartDataColors = (el) => {
    const raw = el.getAttribute('data-echarts');
    if (!raw) return null;
    let obj;
    try { obj = JSON.parse(raw); } catch { return null; }
    const res = { explicit: false, colors: [], hasMark: false, markExplicit: false };
    const walk = (v, path, inSeries) => {
      if (v === null || v === undefined) return;
      if (typeof v === 'string') {
        if (!inSeries) return;
        if (path.includes('.data')) return; // series 的数据数组本身
        const isMark = /\.(markLine|markPoint)/.test(path);
        if (isMark) res.hasMark = true;
        if (/^(#([0-9a-f]{3,8})|rgba?\(|transparent)/i.test(v) && !/transparent/i.test(v)) {
          res.colors.push(v);
          if (isMark) res.markExplicit = true;
        }
        return;
      }
      if (Array.isArray(v)) { for (const it of v) walk(it, path, inSeries); return; }
      if (typeof v === 'object') {
        if (inSeries && /\.(markLine|markPoint)(\.|$)/.test(path + '.') ) res.hasMark = true;
        for (const k of Object.keys(v)) {
          const inS = inSeries || /(^|\.)series/.test(path + '.' + k) || path === '' && k === 'series';
          walk(v[k], path + '.' + k, inS);
        }
      }
    };
    // detect mark presence at object level too (markLine/markPoint may hold only data/style)
    const scanMarks = (v) => {
      if (v === null || typeof v !== 'object') return;
      if (Array.isArray(v)) { for (const it of v) scanMarks(it); return; }
      for (const k of Object.keys(v)) {
        if (k === 'markLine' || k === 'markPoint') res.hasMark = true;
        scanMarks(v[k]);
      }
    };
    scanMarks(obj);
    walk(obj, '', false);
    if (res.colors.length) res.explicit = true;
    return res;
  };

  /**
   * chartYRange —— 纵轴数据范围度量：解析 series 数值型 data 的极值（仅纯数字叶子），
   *   以及显式声明的 yAxis.min / yAxis.max。供 CHART_Y_RANGE（0 起点/范围过宽）判定。
   * 返回 { dataMin, dataMax, yMin, yMax }；无数字 data 或解析失败返回 null。
   */
  const chartYRange = (el) => {
    const raw = el.getAttribute('data-echarts');
    if (!raw) return null;
    let obj;
    try { obj = JSON.parse(raw); } catch { return null; }
    if (!obj || typeof obj !== 'object') return null;
    const nums = [];
    const walk = (v, inSeriesData) => {
      if (v === null || v === undefined) return;
      if (typeof v === 'number' && Number.isFinite(v) && inSeriesData) { nums.push(v); return; }
      if (Array.isArray(v)) { for (const it of v) walk(it, inSeriesData); return; }
      if (typeof v === 'object') {
        for (const k of Object.keys(v)) {
          const asData = k === 'data' ? true : inSeriesData;
          walk(v[k], asData);
        }
      }
    };
    // only descend into series -> data
    const series = obj.series;
    if (series) {
      const arr = Array.isArray(series) ? series : [series];
      for (const s of arr) if (s && typeof s === 'object') walk(s.data, true);
    }
    if (!nums.length) return null;
    const dataMin = Math.min(...nums);
    const dataMax = Math.max(...nums);
    const y = Array.isArray(obj.yAxis) ? obj.yAxis[0] : obj.yAxis;
    const yMin = y && typeof y.min === 'number' ? y.min : null;
    const yMax = y && typeof y.max === 'number' ? y.max : null;
    return { dataMin, dataMax, yMin, yMax };
  };

  /**
   * collectChartSeries —— 逐 series 捕获颜色状态（系列/数据点 marker 随机色的根因）：
   *   每个 series 记录 { type, name, symbol, hasSeriesColor, colors }：
   *   - hasSeriesColor：series.color 或 series.itemStyle.color 是否显式存在
   *     （series.color 决定线条与数据点 marker 的填充色；只设 lineStyle.color 时
   *       marker/symbol 仍用 ECharts 默认色板 = 随机）
   *   - colors：该 series 下除 markLine/数据外的显式颜色串（hex/rgba）
   */
  const collectChartSeries = (el) => {
    const raw = el.getAttribute('data-echarts');
    if (!raw) return null;
    let obj;
    try { obj = JSON.parse(raw); } catch { return null; }
    const list = obj && obj.series;
    if (!list) return null;
    const arr = Array.isArray(list) ? list : [list];
    const out = [];
    for (const s of arr) {
      if (!s || typeof s !== 'object') continue;
      const colors = [];
      const collect = (v, path) => {
        if (v === null || v === undefined) return;
        if (typeof v === 'string') {
          if (path.includes('.data') || /\.(markLine|markPoint)/.test(path)) return;
          if (/^(#([0-9a-f]{3,8})|rgba?\(|transparent)/i.test(v) && !/transparent/i.test(v)) {
            colors.push(v);
          }
          return;
        }
        if (Array.isArray(v)) { for (const it of v) collect(it, path); return; }
        if (typeof v === 'object') {
          for (const k of Object.keys(v)) collect(v[k], path + '.' + k);
        }
      };
      collect(s, '');
      const hasSeriesColor =
        typeof s.color === 'string' ||
        (s.itemStyle && typeof s.itemStyle.color === 'string');
      out.push({
        type: s.type || 'line',
        name: s.name || '',
        symbol: s.symbol || null,
        hasSeriesColor: !!hasSeriesColor,
        colors
      });
    }
    return out.length ? out : null;
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
    /** 实测 URL（重定向后的最终地址，含 query/hash）——报告 URL: 行溯源输入 */
    url: location.href,
    /** body 自身底色（树从 body.children 开始，body 底色需单独带回供面积归因补全） */
    bodyBg: bodyOwn && bodyOwn.a > 0 ? blend(bodyOwn, [255, 255, 255]).map((v) => Math.round(v)) : null
  };

  /** 数值保留两位小数（防亚像素抖动，判定层再决定取整时机） */
  const f2 = (n) => Math.round(n * 100) / 100;
  /** 解析 linear-gradient 中的颜色 stop（≤4 个，rgba/hex；radial/解析失败返回 null）——GRADIENT_CONTRAST 输入 */
  const parseGradStops = (s) => {
    if (!s || !/linear-gradient\(/i.test(s)) return null;
    const inner = s.slice(s.toLowerCase().indexOf('linear-gradient('));
    const colors = inner.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || [];
    if (colors.length < 2 || colors.length > 4) return null;
    const stops = colors.map(parseCol).filter(Boolean);
    return stops.length >= 2 ? stops : null;
  };
  /** 直接文本摘要：压空白、截断到 40 字（树体积控制） */
  const clip = (s) => {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  };

  /**
   * measureTextDelta —— 元素子树文本行盒（全部文本节点并集）垂直中心 相对 元素盒子中心的偏移 px。
   * 用于 CONTROL_TEXT_CENTER（按钮等交互元素内文字是否垂直居中）；无可见文本返回 null。
   * 注意：line box 含行高上下 half-leading，阈值（默认 4px）在规则层取。
   */
  const measureTextDelta = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let top = null;
    let bottom = null;
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent || !node.textContent.trim()) continue;
      if (node.parentElement && node.parentElement.closest('script,style,noscript')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (!(r.height > 0) || !(r.width > 0)) continue;
      top = top === null ? r.top : Math.min(top, r.top);
      bottom = bottom === null ? r.bottom : Math.max(bottom, r.bottom);
    }
    if (top === null) return null;
    const er = el.getBoundingClientRect();
    return f2((top + bottom) / 2 - (er.top + er.bottom) / 2);
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
  const walk = (el, parentBg, parentStops) => {
    const out = [];
    const ordMap = {};
    for (const child of el.children) {
      if (SKIP.has(child.tagName)) continue;
      const cs = getComputedStyle(child);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = child.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        /* 零尺寸节点自身不渲染：子节点上提并完整继承父级背景/渐变上下文 */
        out.push(...walk(child, parentBg, parentStops));
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
      const interactive = child.matches(INTERACTIVE);
      const media = child.matches(MEDIA);
      /* 定位锚点（ISSUE 消息 pinpoint 元素用）：
         tid = 首个 data-test* 属性值（跨框架测试定位约定，data-testid / data-test / ember data-test-*）
         alt = 图像替代文本（IMG_BROKEN 占位建议输入）；aria = aria-label
         ord = 同标签渲染兄弟序号（1 起，树内计数，与 textGroups 分组口径一致） */
      const testAttr = child.getAttributeNames().find((a) => a.startsWith('data-test'));
      const tid = testAttr ? (child.getAttribute(testAttr) || '') : '';
      const alt = child.tagName === 'IMG' ? (child.getAttribute('alt') || '') : '';
      const aria = child.getAttribute('aria-label') || '';
      const tagKey = child.tagName;
      ordMap[tagKey] = (ordMap[tagKey] || 0) + 1;
      /* 渐变背景（linear/radial-gradient）——有效 stop 颜色供 GRADIENT_CONTRAST：
         自身渐变优先（blend 到自身有效底色）；无自身渐变且自身底非不透明时继承祖先渐变；
         自身不透明纯底遮住祖先渐变 → null（不再向下传递） */
      const gradient = /gradient\(/i.test(cs.backgroundImage || '');
      const ownStops = gradient ? parseGradStops(cs.backgroundImage) : null;
      const ownStopsB = ownStops ? ownStops.map((c) => blend(c, bg).map((v) => Math.round(v))) : null;
      const inheritedStops = (bgOwn && own.a >= 1) ? null : (parentStops || null);
      const gradStops = ownStopsB || inheritedStops;
      const childStops = ownStopsB || inheritedStops;
      /* 图像加载状态（IMG_BROKEN 输入）：complete && naturalWidth===0 = 已请求且失败；
         懒加载未触发时 complete=false，天然排除，无误报 */
      const isImg = child.tagName === 'IMG';
      const imgBroken = isImg ? (child.complete && child.naturalWidth === 0) : false;
      const imgSrcTail = isImg ? (child.getAttribute('src') || '').slice(-24) : '';
      /* 图表文字前景（blend 到容器有效背景上）——图表文字对比度规则输入 */
      let chartTextFgs = null;
      let chartTopRisk = null;
      let chartDataExplicit = null;
      let chartDataColors = null;
      let chartHasMark = null;
      let chartMarkExplicit = null;
      let chartSeries = null;
      let yRange = null;
      if (media) {
        const cols = collectChartTextColors(child);
        if (cols) {
          const fgs = [];
          for (const c of cols) {
            const p = parseCol(c);
            if (p) fgs.push(blend(p, bg).map((v) => Math.round(v)));
          }
          if (fgs.length) chartTextFgs = fgs;
        }
        if (child.hasAttribute('data-echarts')) {
          chartTopRisk = computeChartTopRisk(child);
          const dc = collectChartDataColors(child);
          if (dc) {
            chartDataExplicit = dc.explicit;
            chartDataColors = dc.colors;
            chartHasMark = dc.hasMark;
            chartMarkExplicit = dc.markExplicit;
          }
          chartSeries = collectChartSeries(child);
          yRange = chartYRange(child);
        }
      }
      const kids = walk(child, bg, childStops);
      out.push({
        tag: child.tagName.toLowerCase(),
        id: child.id || '',
        cls: child.classList.length ? Array.from(child.classList).slice(0, 2).join('.') : '',
        role: child.getAttribute('role') || '',
        tid,
        alt,
        aria,
        ord: ordMap[tagKey],
        imgBroken,
        imgSrcTail,
        gradStops: gradStops || null,
        text: clip(text),
        rect: { x: f2(r.x), y: f2(r.y), w: f2(r.width), h: f2(r.height) },
        pos: cs.position,
        interactive,
        media,
        gradient,
        chartTextFgs,
        chartTopRisk,
        chartDataExplicit,
        chartDataColors,
        chartHasMark,
        chartMarkExplicit,
        chartSeries,
        yRange,
        /* 交互元素内文字垂直居中偏移 px（无文本/不可测为 null） */
        vcenterDelta: interactive ? measureTextDelta(child) : null,
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

  return { pageInfo: { ...pageInfo, cssom: scanCssom() }, tree: walk(document.body, [255, 255, 255], null) };
};

/**
 * collectPage —— 单页面完整采集流程（模块主入口）
 *
 * @param browser  已启动的 Playwright Browser 实例（由启动器管理生命周期）
 * @param opts
 *   - name          夹具名（不含扩展名，决定输入/输出文件名）
 *   - inputDir      输入目录（含 <name>.html）
 *   - outDir        输出目录（产物落盘处，自动创建）
 *   - cfg           已合并的度量配置（config.mjs loadConfig().cfg）
 *   - echo          配置回显串（写入报告 Config: 行）
 *   - fullArtifacts 实验模式开关：false=工具默认仅 report.txt（跳过 aria/CDP 采集，更快）；
 *                   true=额外产出 aria/geometry/cdp 三产物（格式对比实验、style_eval 用）
 *   - filePath      （可选）直接指定的页面文件绝对路径；提供时跳过 inputDir/<name>.html 拼装，
 *                   用于单文件独立分析（src/analyze.mjs），支持任意扩展名
 *   - url           （可选）远程页面 http(s) URL；提供时跳过本地文件拼装直接打开该地址，
 *                   等待 networkidle（30s 超时后回退 load），供 src/analyze.mjs URL 模式使用
 * @returns { name, sizes, issues } 供启动器汇总（工具模式下 sizes 仅含 report）
 */
export async function collectPage(browser, { name, inputDir, outDir, cfg, echo, fullArtifacts = false, filePath, url }) {
  mkdirSync(outDir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  });
  const page = await ctx.newPage();
  if (url) {
    /* URL 模式：networkidle 尽量等齐异步资源；长轮询类页面超时后回退 load 兜底 */
    if (!/^https?:\/\//i.test(url)) throw new Error(`仅支持 http(s) URL: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
      if (e.name !== 'TimeoutError') throw e;
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    }
  } else {
    const href = filePath ? pathToFileURL(filePath).href : pathToFileURL(join(inputDir, name + '.html')).href;
    await page.goto(href);
  }

  /* 采集：事实树必采；aria/CDP 仅实验模式（工具模式跳过以提速） */
  const geo = await page.evaluate(COLLECT, { w: VIEWPORT.width, h: VIEWPORT.height });
  let aria = null;
  let snap = null;
  if (fullArtifacts) {
    aria = await page.ariaSnapshot();
    const cdp = await ctx.newCDPSession(page);
    snap = await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [], includeDOMRects: true });
  }

  /* 判定与渲染：facts 构建会向 geo 节点挂 _ 前缀内部字段，
     落盘前以 replacer 剥除，保证 geometry.json 只含纯净事实 */
  const issues = runMetrics(geo, cfg);
  const report = formatReport(name, geo, issues, echo);

  const files = { report: join(outDir, name + '.report.txt') };
  const sizes = { report: 0 };
  writeFileSync(files.report, report, 'utf8');
  sizes.report = statSync(files.report).size;
  if (fullArtifacts) {
    const clean = JSON.parse(JSON.stringify(geo, (k, v) => (k.startsWith('_') ? undefined : v)));
    files.aria = join(outDir, name + '.aria.yml');
    files.geo = join(outDir, name + '.geometry.json');
    files.cdp = join(outDir, name + '.cdp.json');
    writeFileSync(files.aria, aria, 'utf8');
    writeFileSync(files.geo, JSON.stringify(clean, null, 2), 'utf8');
    writeFileSync(files.cdp, JSON.stringify(snap), 'utf8');
    sizes.aria = statSync(files.aria).size;
    sizes.geo = statSync(files.geo).size;
    sizes.cdp = statSync(files.cdp).size;
  }

  const result = { name, sizes, issues: issues.length };
  await ctx.close();
  return result;
}
