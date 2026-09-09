# OVERLAP 规则 True Positive 新增测试用例

本目录包含 6 个含**真实重叠缺陷**的 H5 页面，用于回归验证优化后的 OVERLAP
算法（定位分层豁免 + 交叠面积占比门槛）对真缺陷的检出能力。

## 与另两组挑战集的关系

| 目录 | 语义 | 验证目标 |
|---|---|---|
| `../false_positive` | 合法 CSS 分层技巧 | 优化后应 **0 条** OVERLAP |
| `../true_positive` | 真实保存页面 | 优化后应 **≥1 条** OVERLAP |
| 本目录 `new_test` | 人工植入的单缺陷用例 | 优化后应 **≥1 条** OVERLAP |

## 用例说明

所有用例遵循主套件夹具方法论：**同骨架（header + 卡片 + tabbar，375×812）+ 单一缺陷植入**，
且缺陷全部发生在**常规文档流元素之间**（static/relative，不使用 absolute/fixed），
交叠面积占较小元素比例均 ≥10%，落在优化后算法的报障区间。

| # | 文件 | 缺陷根因 | 植入手法 | 预期交叠占比 |
|---|------|---------|---------|------------|
| 1 | `margin_overlap_cards.html` | 负 margin 堆叠参数过头 | `.card + .card { margin-top: -80px }` | ~46% |
| 2 | `avatar_pile.html` | 头像横向堆叠过度 | `.avatar + .avatar { margin-left: -36px }`（48px 头像） | ~75% |
| 3 | `price_collision.html` | 图文排布参数错误 | 信息面板 `margin-left: -120px` 压住 160px 配图 | ~75% |
| 4 | `section_cover.html` | 区块间距计算错误 | 内容面板 `margin-top: -70px` 盖住促销横幅文案 | ~54% |
| 5 | `tag_pileup.html` | 胶囊标签堆叠过大 | `.tag + .tag { margin-left: -28px }`（~52px 标签） | ~54% |
| 6 | `relative_shift_card.html` | relative 视觉位移未回流 | `position: relative; top: -70px`（占流不动，上移盖卡片 + 拉出空洞） | ~33% |

## 运行方式

```powershell
# 单独分析某个用例
node src/analyze.mjs OVERLAP_challenge/new_test/margin_overlap_cards.html

# 批量（PowerShell）
Get-ChildItem OVERLAP_challenge/new_test/*.html | ForEach-Object { node src/analyze.mjs $_.FullName }
```

## 预期结果（已验证 2026-09-09）

| 用例 | OVERLAP | 附带信号 |
|---|---|---|
| margin_overlap_cards | ×3（46%） | 无 |
| avatar_pile | ×9（25%~75%） | 无 |
| price_collision | ×1（75%） | 无 |
| section_cover | ×1（46%） | 无 |
| tag_pileup | ×5（54%） | 无 |
| relative_shift_card | ×1（33%） | SPACING + VOID_BAND（同根因：relative 位移拉出 82px 空洞） |

消息形如：`[OVERLAP] article.card 与 article.card 重叠 351×80px 占较小元素 46% (容器 main.card-list)`。
