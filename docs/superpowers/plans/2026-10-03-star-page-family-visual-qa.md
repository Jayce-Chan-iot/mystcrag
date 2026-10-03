# 玄圭星台全站视觉与最终 QA Implementation Plan

> **供执行代理使用：** REQUIRED SUB-SKILL：逐任务使用 `superpowers:executing-plans`；用 `- [ ]` 跟踪步骤。GPT 先串行登记唯一 owner、`task/<task-id>-<slug>` 分支、独立工作树和精确可写路径，并置为 `IN_PROGRESS`；执行者不编辑任务注册表。GPT 只审查和下发。

**Goal / 目标：** 先核收用户已完成的洁净素材与首页、问卦结果、DIY 桌面/手机效果图，再把克制、可读且保留塔罗元素的东方当代视觉应用到全部主要页面并完成真实浏览器验收。

**Architecture / 架构：** `star-tokens.css` 是颜色/字体语义的单一源；`packages/ui` 只放跨页面复用的控件；具体页面族样式继续放现有 `star-*.css`。生成素材先由独立 `ASSET` 任务核收、登记来源并放入 `public/`，页面只消费类型化路径。按页面族串行改，避免与入口、三语、Oracle、工作台任务同时锁同一文件；照片不加滤镜，动效不掌握业务状态。

**Tech Stack / 技术栈：** Next.js/React、CSS tokens、现有 `packages/ui`、`scripts/ui-qa/capture_star_platform.py`、浏览器与可访问性检查。

**Spec / 规格：** [已批准的中文设计规格](../specs/2026-10-03-star-platform-ux-remediation-design.md) §3、§5.2–5.3、§6、§8–10。

## 全局约束

- 视觉候选值：曜石墨 `#111820`、冷瓷白 `#F4F5F2`、正文深墨 `#222A2F`、辅助字 `#4B565B`、浅底金属文字 `#735938`；实际背景叠层、12 px 文字、按钮和状态须各自测 WCAG AA。
- 保留星台问卦与塔罗两种真实主题入口；首页图像减少无意义的上下留白，首屏露出下一内容入口及低干扰向下提示；`prefers-reduced-motion` 直接呈现终态。
- 六张新素材背景平整哑光、道具少且干净；不出现粗石纹、裂纹、密集星线或脏污颗粒。DIY 图右侧是真正带小弯钩的串珠钩针，托盘全空；塔罗图不能伪造一套与现有授权牌组冲突的新牌面。
- 不强制引入依赖。MotionSites 仅为观感参考；无许可证的 House of Lune 不复制代码/素材。Motion/Embla/Radix 仅是 MIT 能力候选，若新增依赖需独立登记 manifests/lockfile 并审包体、许可证。
- 设计工作只改表现，不变更 Auth、商品权威、算法或生产 3D 生命周期。

## 评审重点

1. 深色首页与浅色操作区切换时，导航/细字仍有足够对比（任务 2、4）。
2. 首屏图片在窄屏、短屏和慢加载下不产生突兀空白或布局跳动（任务 3、4）。
3. 语言切换后的最长英文/繁体内容不会破坏卡片与按钮（任务 3、4）。
4. Tarot 开启时首页有可辨识牌面元素和入口，关闭时不出现死导航或空白；Oracle 仍有入口但不独占品牌叙事（任务 3、4）。
5. 减少动效、键盘与低性能设备仍可到达所有主操作（任务 3、4）。

---

### 任务 1：产品所有者视觉确认（owner `SOL`；不改运行时代码）

**交付：** 三组中文标注效果图：① 首页桌面/手机；② 问卦结果桌面/手机；③ DIY 工作台桌面/手机。图中清楚展示同一色彩、按钮、卡片、托盘、散珠与成串状态；标注“概念效果，不代表真实库存或报价”。视觉反馈记录在规格或后续登记的设计决策文档，而不是直接改页面。

- [ ] 以用户截图为问题基线制作三组图；字号、布局、真实珠材比例和选中状态要可辨。
- [ ] 核对视觉图与规格：不露专业卦象、没有固定 ID 错页、无常驻橘圈、托盘更大且无静态方框。
- [ ] 产品所有者明确确认或指出修改后，再放行任务 2–4 的大面积视觉修改。

### 任务 1A：已生成素材核收与运行时登记（拟登记 `TASK-UX-ASSET-001`；Qwen 3.8 Flash / `ASSET`；不改页面）

**文件：** 新增 `apps/frontend/public/star-platform/hero-clean-desktop.webp`、`hero-clean-mobile.webp`、`entry-ai-clean.webp`、`entry-tarot-clean.webp`、`entry-oracle-clean.webp`、`entry-diy-clean.webp`；修改 `apps/frontend/src/features/design/model/star-assets.ts` 及相邻测试、`docs/UI_REFERENCE_AND_ASSET_MANIFEST.md`，新增 `apps/frontend/public/star-platform/CLEAN_ASSET_SOURCE.md`。不改 `apps/frontend/app/page.tsx` 或 CSS；原图来源位置须先核对，不把聊天预览路径当作运行时路径。

**接口：** `STAR_PLATFORM_ASSETS` 增加六个稳定键及宽高/中文 alt 意图；图片文件名与用途一一对应。保留原素材作为回退，不覆盖现有用户文件；仅以经核收的新图替换后续页面引用。

- [ ] 写失败素材测试：六个目标文件/尺寸/映射存在，DIY 图经人工原尺寸复核为**空托盘+串珠钩针**；首页、AI、DIY 和色彩素材背景无脏污/粗纹/文字/价格。问卦、塔罗两张入口装饰图使用规格 §3.1 中产品所有者逐字节指定的文件与 SHA-256，允许这两张图保留旧化铜钱/粗石及插画牌面；入口插画不得冒充运行时授权 Tarot 牌组或抽牌结果。原尺寸人工复核、来源记录与可访问替代文字仍必需。
- [ ] 运行 `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/star-assets.test.tsx`，确认缺新键/文件的红因；视觉判断单独保留核收记录，不假装像素测试能证明钩针正确。
- [ ] 对用户已生成图片做选片、无损检查与 WebP 优化，保留生成提示词、工具、日期、SHA-256 和用途；不生成额外杂乱装饰图，也不自行改成锥子。问卦/塔罗入口只使用产品所有者指定原图，不用先前清洁候选顶替；塔罗入口仅是装饰摄影，真实抽牌资产仍须与现有授权牌组一致。首页桌面/手机 hero 仍须提供符合现行原生尺寸门槛的源图，不可通过插值放大或修改 `STAR_PLATFORM_MIN_SIZE` 规避；条件未满足时本任务保持 `BLOCKED`，不登记未通过验收的运行时图片。
- [ ] 重跑目标测试、前端 typecheck/build 和 `git diff --check`，提交 `feat(assets): curate clean Star Platform imagery`。

### 任务 2：语义 token 与共享控件（`FRONTEND`/`UI` 模块分开登记，各自 owner Qwen 3.8 Flash，分别拟登记 `TASK-UX-VISUAL-FE-001` / `TASK-UX-VISUAL-UI-001`）

**文件：** `FRONTEND` 修改 `apps/frontend/app/styles/star-tokens.css`、`star-shell.css`、`apps/frontend/app/globals.css`、`docs/UI_DESIGN_SYSTEM.md`；`UI` 仅在复用确有证据时修改 `packages/ui/src/instrument-button.tsx`、`star-surface.tsx` 及相邻测试。两任务串行，先 token 后控件。

**接口：** 保持已有 `--star-*` 单一源与 legacy aliases；新增/调整 `--star-ink`、`--star-paper`、`--star-micro-text` 等语义值时记录深/浅背景适用范围。`InstrumentButton` 的 primary/secondary/destructive/loading/focus 状态可辨，44 px 触控下限。

- [ ] 写失败合同测试：深浅界面 token、按钮状态、焦点、前景/背景对比度；每个实际颜色组合达到普通文字 ≥4.5:1、大字 ≥3:1。
- [ ] 运行前端 style contract/共享 UI 测试，确认新增断言红因。
- [ ] 落语义 token 与有限共享控件，不用全局 body 滤镜或 CSS `zoom` 修饰页面。
- [ ] 重跑相邻测试、typecheck/lint 与真实截图 AA 采样，提交各 owner 的 Conventional Commit。

### 任务 3：按页面族落地（`FRONTEND` 模块拆成互不重叠或串行的 Qwen 3.8 Flash 任务；每族独立 ID/分支/可写路径）

**每行单独登记和评审，先 1 后 2–4；共用 `star-content.css` 的行必须串行。文件/失败测试：**

| 页面族 | 精确实现文件 | 失败测试文件与关键断言 |
| --- | --- | --- |
| 首页（拟 `TASK-UX-VISUAL-HOME-001`） | `apps/frontend/app/page.tsx`、`apps/frontend/app/styles/star-acquisition.css` | 新建 `apps/frontend/src/features/design/star-home-hero.test.tsx`：首屏主 CTA、下滑提示、下一内容露出、减少动效终态、启用时 Tarot/Oracle 双主题入口且图片消费核收素材，关闭功能无死入口；不再把密集星图纹理铺满首屏 |
| AI/Tarot/水晶库（拟 `TASK-UX-VISUAL-CONTENT-001`） | `apps/frontend/src/features/questionnaire/components/questionnaire-wizard.tsx`、`apps/frontend/src/features/tarot/components/tarot-setup.tsx`、`tarot-draw.tsx`、`tarot-result.tsx`、`tarot-recommendation-card.tsx`、`apps/frontend/src/features/library/components/crystal-library-page.tsx`、`apps/frontend/app/styles/star-content.css` | 现有 `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`、`apps/frontend/src/features/tarot/tarot-result.test.tsx`、`apps/frontend/src/features/library/components/crystal-library-page.test.tsx`：关键流程不变、三语状态可读、卡片不溢出；入口图只用已核收资产 |
| 画廊/个人/设计详情/错误（拟 `TASK-UX-VISUAL-ACCOUNT-001`） | `apps/frontend/src/features/gallery/components/gallery-page.tsx`、`apps/frontend/src/features/profile/components/profile-page.tsx`、`apps/frontend/src/features/design/components/design-results.tsx`、`apps/frontend/src/components/flow-notice.tsx`、`apps/frontend/app/styles/star-content.css` | 现有 `apps/frontend/src/features/design/star-content-contract.test.tsx`、`apps/frontend/src/features/design/design-detail-integration.test.tsx`：主 CTA、空/错状态、200% 重排、价格来源 |
| 知识后台基础可读性（拟 `TASK-UX-VISUAL-ADMIN-001`） | `apps/frontend/src/features/admin-knowledge/components/console-primitives.tsx`、`apps/frontend/app/admin/knowledge/layout.tsx` | 新建 `apps/frontend/src/features/admin-knowledge/admin-visual-contract.test.tsx`：表单标签/状态对比、键盘焦点；若需额外 CSS，先在任务登记列出准确文件 |

**接口：** 每个页面族消费同一 token、语言键与状态控件；路线与已有可用功能保持原样，关闭的功能隐藏。没有明确跨页面复用前不增加新共享组件。

- [ ] 每族在表中列出的测试先写失败断言：无假入口、原有关键动作仍可用、状态文案/主 CTA 可读、减少动效后无等待；首页同时表达塔罗与星台（仅在各自功能开启时），并让下一内容入口可见。
- [ ] 在前端工作区运行 `pnpm --filter @mystcrag/frontend exec tsx --test <本行列出的测试文件>` 确认红因，按顺序仅改该族；图片加载保留稳定比例，产品影像不着色。
- [ ] 每族重跑相邻测试、前端 typecheck/lint，浏览器检查 320×568、390×844、768×1024、1440×900、1440×560；按族提交。

### 任务 4：跨页面真实浏览器验收（拟登记 `TASK-UX-QA-001`；DeepSeek V4.1 Flash / `QA`，待全部实现任务完成后执行；GPT 独立复核）

**文件：** 扩展 `scripts/ui-qa/capture_star_platform.py`、`docs/INTERACTION_TEST_PLAN.md`、`docs/USER_ACCEPTANCE_CHECKLIST.md`；新增或更新同目录自检与跨工作区测试。QA 证据遵循 `docs/governance/QA_EVIDENCE_RETENTION.md`，不得把生成截图提交到源码目录。

**接口：** 保留现有 73 项浏览器矩阵，新增三语 × 页面族 × 关键视口的对比/溢出检查，以及两用户 DIY、无历史直接空托盘/有历史选择、首珠幂等、问卦不重抽、真实 SKU/价格、托盘/珠子/导出几何和 `prefers-reduced-motion` 断言。首页同时检查 Tarot 与 Oracle 的可用能力布局，资产原图由人工核收而非仅靠自动化判断。基线与新值同浏览器/缩放/数据集测量。

- [ ] 写失败 QA 自检：故意注入低对比、越界 CTA、重复问卦、首珠前出现已保存设计、错误所有权时脚本必须报告 FAIL；原 73 项不得被删除或弱化。
- [ ] 运行自检确认红因，再实现新增探针；不要把真实失败改成 SKIP。
- [ ] 运行全浏览器矩阵、模块相邻测试、`node --test tests/architecture.test.mjs`、`pnpm validate`、`git diff --check`，记录准确 PASS/FAIL 数字。
- [ ] 人工核对效果图与最终截图的关键差异；存在明显落差时退回对应页面族任务，不直接宣布完成。
- [ ] 提交 `test(qa): verify three-locale Star Platform journeys`。

**最终完成条件：** 所有子系统计划的合同/实现/QA 任务均 DONE，三组视觉稿获产品所有者确认，全部主要页面三语和核心流程通过；最终合并/发布仍须产品所有者单独确认，不能因计划或概念图完成宣称整体交付。
