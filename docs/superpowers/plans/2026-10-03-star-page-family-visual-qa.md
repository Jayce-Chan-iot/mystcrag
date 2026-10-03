# 玄圭星台全站视觉与最终 QA 实施计划

> **供执行代理使用：** 必须逐任务使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`；用 `- [ ]` 跟踪步骤。每个任务先登记唯一 owner、分支、精确可写路径并置为 `IN_PROGRESS`。

**目标：** 先由产品所有者确认首页、问卦结果、DIY 桌面/手机效果图，再把统一、可读的东方当代视觉应用到全部主要页面并完成真实浏览器验收。

**架构：** `star-tokens.css` 是颜色/字体语义的单一源；`packages/ui` 只放跨页面复用的控件；具体页面族样式继续放现有 `star-*.css`。按页面族串行改，避免与入口、三语、Oracle、工作台任务同时锁同一文件。现有产品照片不加滤镜，动效不掌握业务状态。

**技术栈：** Next.js/React、CSS tokens、现有 `packages/ui`、`scripts/ui-qa/capture_star_platform.py`、浏览器与可访问性检查。

**规格：** [已批准的中文设计规格](../specs/2026-10-03-star-platform-ux-remediation-design.md) §3、§6、§8–10。

## 全局约束

- 视觉候选值：曜石墨 `#111820`、冷瓷白 `#F4F5F2`、正文深墨 `#222A2F`、辅助字 `#4B565B`、浅底金属文字 `#735938`；实际背景叠层、12 px 文字、按钮和状态须各自测 WCAG AA。
- 保留星台品牌与真实产品图；首页图像减少无意义的上下留白，首屏露出下一内容入口及低干扰向下提示；`prefers-reduced-motion` 直接呈现终态。
- 不强制引入依赖。MotionSites 仅为观感参考；无许可证的 House of Lune 不复制代码/素材。Motion/Embla/Radix 仅是 MIT 能力候选，若新增依赖需独立登记 manifests/lockfile 并审包体、许可证。
- 设计工作只改表现，不变更 Auth、商品权威、算法或生产 3D 生命周期。

## 评审重点

1. 深色首页与浅色操作区切换时，导航/细字仍有足够对比（任务 2、4）。
2. 首屏图片在窄屏、短屏和慢加载下不产生突兀空白或布局跳动（任务 3、4）。
3. 语言切换后的最长英文/繁体内容不会破坏卡片与按钮（任务 3、4）。
4. 关闭 Oracle/Tarot 功能时不出现死导航或空白入口（任务 3、4）。
5. 减少动效、键盘与低性能设备仍可到达所有主操作（任务 3、4）。

---

### 任务 1：产品所有者视觉确认（owner `SOL`；不改运行时代码）

**交付：** 三组中文标注效果图：① 首页桌面/手机；② 问卦结果桌面/手机；③ DIY 工作台桌面/手机。图中清楚展示同一色彩、按钮、卡片、托盘、散珠与成串状态；标注“概念效果，不代表真实库存或报价”。视觉反馈记录在规格或后续登记的设计决策文档，而不是直接改页面。

- [ ] 以用户截图为问题基线制作三组图；字号、布局、真实珠材比例和选中状态要可辨。
- [ ] 核对视觉图与规格：不露专业卦象、没有固定 ID 错页、无常驻橘圈、托盘更大且无静态方框。
- [ ] 产品所有者明确确认或指出修改后，再放行任务 2–4 的大面积视觉修改。

### 任务 2：语义 token 与共享控件（`FRONTEND`/`UI` 模块分开登记，各自 owner `QWEN`）

**文件：** `FRONTEND` 修改 `apps/frontend/app/styles/star-tokens.css`、`star-shell.css`、`apps/frontend/app/globals.css`、`docs/UI_DESIGN_SYSTEM.md`；`UI` 仅在复用确有证据时修改 `packages/ui/src/instrument-button.tsx`、`star-surface.tsx` 及相邻测试。两任务串行，先 token 后控件。

**接口：** 保持已有 `--star-*` 单一源与 legacy aliases；新增/调整 `--star-ink`、`--star-paper`、`--star-micro-text` 等语义值时记录深/浅背景适用范围。`InstrumentButton` 的 primary/secondary/destructive/loading/focus 状态可辨，44 px 触控下限。

- [ ] 写失败合同测试：深浅界面 token、按钮状态、焦点、前景/背景对比度；每个实际颜色组合达到普通文字 ≥4.5:1、大字 ≥3:1。
- [ ] 运行前端 style contract/共享 UI 测试，确认新增断言红因。
- [ ] 落语义 token 与有限共享控件，不用全局 body 滤镜或 CSS `zoom` 修饰页面。
- [ ] 重跑相邻测试、typecheck/lint 与真实截图 AA 采样，提交各 owner 的 Conventional Commit。

### 任务 3：按页面族落地（`FRONTEND` 模块拆成互不重叠或串行的 owner `QWEN` 任务）

**每行单独登记和评审，先 1 后 2–4；共用 `star-content.css` 的行必须串行。文件/失败测试：**

| 页面族 | 精确实现文件 | 失败测试文件与关键断言 |
| --- | --- | --- |
| 首页 | `apps/frontend/app/page.tsx`、`apps/frontend/app/styles/star-acquisition.css` | 新建 `apps/frontend/src/features/design/star-home-hero.test.tsx`：首屏主 CTA、下滑提示、下一内容露出、减少动效终态、关闭功能无死入口 |
| AI/Tarot/水晶库 | `apps/frontend/src/features/questionnaire/components/questionnaire-wizard.tsx`、`apps/frontend/src/features/tarot/components/tarot-setup.tsx`、`tarot-draw.tsx`、`tarot-result.tsx`、`tarot-recommendation-card.tsx`、`apps/frontend/src/features/library/components/crystal-library-page.tsx`、`apps/frontend/app/styles/star-content.css` | 现有 `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`、`apps/frontend/src/features/tarot/tarot-result.test.tsx`、`apps/frontend/src/features/library/components/crystal-library-page.test.tsx`：关键流程不变、三语状态可读、卡片不溢出 |
| 画廊/个人/设计详情/错误 | `apps/frontend/src/features/gallery/components/gallery-page.tsx`、`apps/frontend/src/features/profile/components/profile-page.tsx`、`apps/frontend/src/features/design/components/design-results.tsx`、`apps/frontend/src/components/flow-notice.tsx`、`apps/frontend/app/styles/star-content.css` | 现有 `apps/frontend/src/features/design/star-content-contract.test.tsx`、`apps/frontend/src/features/design/design-detail-integration.test.tsx`：主 CTA、空/错状态、200% 重排、价格来源 |
| 知识后台基础可读性 | `apps/frontend/src/features/admin-knowledge/components/console-primitives.tsx`、`apps/frontend/app/admin/knowledge/layout.tsx` | 新建 `apps/frontend/src/features/admin-knowledge/admin-visual-contract.test.tsx`：表单标签/状态对比、键盘焦点；若需额外 CSS，先在任务登记列出准确文件 |

**接口：** 每个页面族消费同一 token、语言键与状态控件；路线与已有可用功能保持原样，关闭的功能隐藏。没有明确跨页面复用前不增加新共享组件。

- [ ] 每族在表中列出的测试先写失败断言：无假入口、原有关键动作仍可用、状态文案/主 CTA 可读、减少动效后无等待；首页包含下一内容入口可见。
- [ ] 在前端工作区运行 `pnpm --filter @mystcrag/frontend exec tsx --test <本行列出的测试文件>` 确认红因，按顺序仅改该族；图片加载保留稳定比例，产品影像不着色。
- [ ] 每族重跑相邻测试、前端 typecheck/lint，浏览器检查 320×568、390×844、768×1024、1440×900、1440×560；按族提交。

### 任务 4：跨页面真实浏览器验收（登记 owner `QWEN`，模块 `QA`）

**文件：** 扩展 `scripts/ui-qa/capture_star_platform.py`、`docs/INTERACTION_TEST_PLAN.md`、`docs/USER_ACCEPTANCE_CHECKLIST.md`；新增或更新同目录自检与跨工作区测试。QA 证据遵循 `docs/governance/QA_EVIDENCE_RETENTION.md`，不得把生成截图提交到源码目录。

**接口：** 保留现有 73 项浏览器矩阵，新增三语 × 页面族 × 关键视口的对比/溢出检查，以及两用户 DIY、问卦不重抽、真实 SKU/价格、托盘/珠子/导出几何和 `prefers-reduced-motion` 断言。基线与新值同浏览器/缩放/数据集测量。

- [ ] 写失败 QA 自检：故意注入低对比、越界 CTA、重复问卦/错误所有权时脚本必须报告 FAIL；原 73 项不得被删除或弱化。
- [ ] 运行自检确认红因，再实现新增探针；不要把真实失败改成 SKIP。
- [ ] 运行全浏览器矩阵、模块相邻测试、`node --test tests/architecture.test.mjs`、`pnpm validate`、`git diff --check`，记录准确 PASS/FAIL 数字。
- [ ] 人工核对效果图与最终截图的关键差异；存在明显落差时退回对应页面族任务，不直接宣布完成。
- [ ] 提交 `test(qa): verify three-locale Star Platform journeys`。

**最终完成条件：** 所有子系统计划的合同/实现/QA 任务均 DONE，三组视觉稿获产品所有者确认，全部主要页面三语和核心流程通过；最终合并/发布仍须产品所有者单独确认，不能因计划或概念图完成宣称整体交付。
