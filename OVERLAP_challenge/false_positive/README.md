# OVERLAP 规则 False Positive 挑战用例

本目录包含 6 个设计良好的 H5 页面，每个页面使用了合法的 CSS 布局技巧，
视觉效果完全正常，但当前 OVERLAP 规则会将其误报为"元素重叠"。

## 根因

当前 OVERLAP 算法（`src/rules/layer-basic.mjs:42-52`）对同一父容器下
所有兄弟节点做 AABB 相交检测，相交区域 ≥ 0.5×0.5px 即报 error。
算法**完全忽略** `position`、`z-index`、层叠上下文等 CSS 语义，
而采集层已经采集了 `pos` 字段（`src/collect.mjs:152`）却未被规则使用。

## 用例说明

| # | 文件 | 场景 | 预期误报原因 |
|---|------|------|-------------|
| 1 | `absolute_layering.html` | absolute 背景层 + relative 内容层 | 同父兄弟矩形完全重叠，但这是标准分层渲染 |
| 2 | `badge_overlay.html` | 角标 absolute 定位溢出卡片边缘 | 角标与卡片内容矩形相交，电商标准设计 |
| 3 | `negative_margin_stack.html` | 负 margin-top 卡片堆叠 | 相邻卡片矩形有 10px 重叠带，视觉紧贴效果 |
| 4 | `hero_overlay.html` | Hero 图 + 渐变遮罩 + 文字三层叠放 | 三个同父兄弟矩形完全重叠 |
| 5 | `decoration_layer.html` | 装饰圆形色块 + 内容层 | 装饰元素与内容矩形重叠，品牌设计手法 |
| 6 | `floating_action_button.html` | FAB 悬浮按钮 fixed 定位 | FAB 与 tabbar 矩形重叠，Material Design 组件 |
| 7 | `gradient_overlay_card.html` | 图片 + 渐变蒙版 + 文字三层结构 | 三个同父兄弟完全重叠，内容平台标准封面设计 |

## 运行方式

```bash
# 批量度量所有挑战用例
node src/run.mjs --fixture-dir false_positive_cases/OVERLAP_challenge

# 或单独分析某个文件
node src/analyze.mjs false_positive_cases/OVERLAP_challenge/absolute_layering.html
```

## 预期结果

每个用例至少产生 1 条 `[OVERLAP]` error，但页面设计无实际缺陷。
这些误报全部源于算法缺少对 `position` 语义的感知。
