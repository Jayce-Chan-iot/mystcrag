# 玄圭星台两模型执行派发 Implementation Plan

> **供执行代理使用：** REQUIRED SUB-SKILL：使用 `superpowers:executing-plans` 逐任务执行下列五份详细计划。GPT 先串行维护 `docs/tasks/TASK_REGISTRY.md`，为每项登记唯一 ID、一个 owner、`task/<task-id>-<slug>` 分支、独立工作树、精确可写路径和验收命令；执行任务不取得注册表写权，以 `- [ ]` 追踪红绿测试、提交与审查。GPT 只做代码审查及任务下发，不改实现代码。

**Goal / 目标：** 交付空托盘首珠创建、历史设计选择、易读问卦、真实手串、克制全站视觉与简繁英三语，且两位执行模型没有并发写同一文件。

**Architecture / 架构：** 契约与持久化先于消费者；DeepSeek 负责 Contract/Database/Backend/AI/Tarot 与最终跨模块 QA，Qwen 负责资产核收、Frontend/UI 与页面族。一个页面文件只在前置任务合入后由后续任务串行接手；主工作树不直接收未审查的跨分支改动。

**Tech Stack / 技术栈：** Next.js 16、React 19、Fastify、Zod、Prisma/PostgreSQL、TypeScript、CSS、Playwright/现有浏览器 QA。

**Spec / 规格：** [已批准的中文规格](../specs/2026-10-03-star-platform-ux-remediation-design.md)；详细计划：[DIY 入口](2026-10-03-star-diy-entry-ownership.md)、[三语内容](2026-10-03-star-three-locale-content.md)、[问卦结果](2026-10-03-star-oracle-result-experience.md)、[手串工作台](2026-10-03-star-bracelet-workbench.md)、[全站视觉与 QA](2026-10-03-star-page-family-visual-qa.md)。

## Global Constraints / 全局约束

- 新设计始于**完全空托盘**；第一颗真实目录珠子被点选前，不生成零珠 `DesignV1`、设计 ID、报价或保存成功状态。
- `/diy` 有历史记录时给“继续已有设计 / 开始新设计”，没有历史时直接空托盘；所有设计都按已验证用户隔离。
- 桌面保留左材料库/中托盘/右检查区，手机保留上托盘/下材料面板；托盘无装饰背景板，珠子有细微间隔、透明弹力线和真实接触阴影。
- 首页同时体现 Tarot 与星台问卦（各自功能开启时）；六张用户已完成素材只做核收、优化、归档，不重新生成脏纹理或锥子图。
- 页眉语言菜单真正切换 `zh-CN`、`zh-TW`、`en-US` 的静态及动态内容；不更改卦象、设计、SKU、价格、货币或未提交编辑。
- 商品/库存/价格/修订/订单权威、现有 Authing 会话、Oracle 随机/幂等、生产 `FlatBraceletEditor` 不得被视觉任务重写。
- 每任务先写失败测试并记录红因，最小实现后跑窄测；移交前跑其详细计划的命令、`git diff --check` 和 `pnpm validate`。任何重要失败必须修复，不能改成 skip。

## Review Focus / 评审重点

1. 首珠前刷新或切语言：不自动预放珠子、不生成设计 ID，刷新按历史入口规则恢复选择器或空托盘，保存/完成不能伪成功；DIY 前端与最终 QA 测试。
2. 同一首珠意图双击、超时重试、两用户同请求键：仅当前 actor 的一份 revision 1；Contract/DB/Backend 与浏览器测试。
3. Tarot 关闭/开启及 Oracle 关闭/开启的首页组合：无死入口，启用时两种主题都有辨识度；首页与浏览器测试。
4. 三语最长文案、320 px/200% 缩放、1440×560：无文字或按钮裁切，当前设计/问卦不重建；三语、页面族与 QA 测试。
5. 托盘放大后拖出删除、散珠命中、成串缝隙/弹力线、PNG 导出与真实尺寸/报价一致；工作台与 QA 测试。

---

## 依赖顺序与执行者

| 波次 | 执行者 | 单任务交付与依赖 | GPT 接收证据 |
| --- | --- | --- | --- |
| 0 | GPT 审查/登记；两执行者只读盘点 | 将本规划候选与最新 `main` 对齐，核对六张最终素材实际文件与现有锁；逐项登记任务，不改其他人工作树 | 基线 SHA、文件清单、任务 ID/owner/分支/精确可写路径 |
| 1 | DeepSeek V4.1 Flash（TraeWork CN） | [DIY 入口计划](2026-10-03-star-diy-entry-ownership.md)任务 1 Contract → 任务 2 Database → 任务 3 Backend；每项独立提交与审查 | 红绿测试、实库隔离、401/owner/库存/重放、精准 diff |
| 1（可并行） | Qwen 3.8 Flash（Qoder CN） | [视觉计划](2026-10-03-star-page-family-visual-qa.md)任务 1A 只核收六张洁净素材；不得编辑页面或共享契约 | 原尺寸人工核收、钩针/空托盘/授权牌面、provenance、资产测试 |
| 2 | Qwen 3.8 Flash | DIY 入口任务 4：历史选择与空托盘首珠前端；仅在波次 1 Contract/DB/Backend 合入后开始 | 五类入口、0/1/多历史、两用户、双击/失败恢复、前端测试 |
| 2（可并行） | DeepSeek V4.1 Flash | [三语计划](2026-10-03-star-three-locale-content.md)任务 2 Contract → 任务 3 AI → Backend → Tarot；与 Qwen 的 DIY 前端路径不重叠 | 三语投影只读、旧会话、无重起卦/改价格、各模块测试 |
| 3 | Qwen 3.8 Flash | 三语任务 1 页眉基础与任务 4 页面消费，再完成[视觉计划](2026-10-03-star-page-family-visual-qa.md)任务 2 的共享 token/UI；各任务按共享文件串行，均先于 Oracle/工作台页面改动 | 页眉真实切换、静态/动态三语、SSR 水合、快速切换竞态、AA 语义色 |
| 4 | Qwen 3.8 Flash | [手串计划](2026-10-03-star-bracelet-workbench.md)任务 1→2→3；[问卦计划](2026-10-03-star-oracle-result-experience.md)任务 1→2；共享 `oracle-result.tsx`/`diy-editor.tsx` 的工作严格串行 | 几何/导出、旧版布局、空托盘、石材与三卡易读、视口截图 |
| 5 | Qwen 3.8 Flash | [视觉计划](2026-10-03-star-page-family-visual-qa.md)首页 → 其余页面族；消费波次 3 已落地的 token/UI，每族独立登记并串行触碰 `star-content.css` | 全站色彩 AA、洁净素材、塔罗/星台平衡、无无效入口 |
| 6 | DeepSeek V4.1 Flash（QA 任务） | 问卦任务 3 与全站视觉任务 4：跨模块/真实浏览器验收；不得趁 QA 修改未登记的实现文件 | 原有 73 项不弱化、三语×视口、双用户、首珠重放、`pnpm validate` |
| 7 | GPT 独立审查 | 审查每项 diff、证据和任务边界；重要问题按原 owner 下发修复，不直接写代码。全部门槛通过后再请产品所有者确认最终页面 | 验收摘要与未完成清单；无授权不推送、不部署 |

共享文件串行锁：`docs/API_SPECIFICATION.md`（DIY Contract → 三语 Contract）；`docs/governance/FEATURE_REGISTRY.md`（DIY Backend → 三语页眉）；`apps/frontend/app/page.tsx`（三语消费 → 首页视觉）；`apps/frontend/src/features/oracle/components/oracle-result.tsx`（三语消费 → Oracle 易读化）；`apps/frontend/src/features/design/components/diy-editor.tsx`（DIY 入口 → 三语消费 → 工作台）；`apps/frontend/app/styles/star-content.css`（页面族逐个）。若任何执行方需要越界，先停下，由 GPT 变更任务登记与依赖，不自行扩大路径。

首批登记时使用以下**拟定**分支；任务 ID 和确切可写文件由详细计划控制，登记前须与最新 `main` 核对。其余页面族沿同一规则按一个页面族一个任务登记，不预先占锁。

| 任务 ID | 执行者 | 拟定分支 | 直接前置 |
| --- | --- | --- | --- |
| `TASK-UX-DIY-CONTRACT-001` | DeepSeek | `task/ux-diy-contract-001-first-bead` | 规划获批 |
| `TASK-UX-DIY-DB-001` | DeepSeek | `task/ux-diy-db-001-idempotency` | DIY Contract |
| `TASK-UX-DIY-BE-001` | DeepSeek | `task/ux-diy-be-001-first-bead-api` | DIY DB |
| `TASK-UX-ASSET-001` | Qwen | `task/ux-asset-001-clean-images` | 素材核收文件可定位；与 DIY Contract/DB/Backend 路径无重叠 |
| `TASK-UX-DIY-FE-001` | Qwen | `task/ux-diy-fe-001-empty-entry` | DIY Backend |
| `TASK-UX-I18N-CONTRACT-001` | DeepSeek | `task/ux-i18n-contract-001-presentation` | DIY Contract 的共享 API 文档已合入 |
| `TASK-UX-I18N-FE-001` | Qwen | `task/ux-i18n-fe-001-header-switch` | DIY Backend 的 `FEATURE_REGISTRY` 已合入 |
| `TASK-UX-I18N-AI-001` → `TASK-UX-I18N-BE-001` → `TASK-UX-I18N-TAROT-001` | DeepSeek | 分别 `task/ux-i18n-ai-001-oracle-copy`、`task/ux-i18n-be-001-read-projections`、`task/ux-i18n-tarot-001-card-projection` | I18N Contract，依次落地 |
| `TASK-UX-BRACELET-FE-001` → `002` → `003` | Qwen | 分别 `task/ux-bracelet-fe-001-layout`、`task/ux-bracelet-fe-002-tray`、`task/ux-bracelet-fe-003-workbench` | DIY FE、相关 token 与视觉确认 |
| `TASK-UX-ORACLE-FE-001` → `002` | Qwen | 分别 `task/ux-oracle-fe-001-cues`、`task/ux-oracle-fe-002-cards` | 三语投影、手串紧凑预览、DIY 入口 |
| `TASK-UX-QA-001` | DeepSeek | `task/ux-qa-001-final-browser-gate` | 全部页面族和三语消费完成 |

## 派发协议与验收

- [ ] GPT 先在独立治理任务内串行登记并切换任务状态，再将本计划和对应详细计划链接交给当前波次的执行者；每个执行者同一时间只领取**一个**已注册任务，明确上游已合入 SHA、可写/禁止路径、失败测试、命令和交付格式。只有路径互不重叠时，两位执行者可并行。
- [ ] 执行者在专用分支/工作树标记 `IN_PROGRESS`，先提交红测证据，最小修复至绿，按路径提交 Conventional Commit，回报 commit SHA、测试数字、`git diff --check` 与工作树状态。
- [ ] GPT 审查代码和证据；发现问题给同一 owner 下发限范围修复单；通过后将任务转 `REVIEW`/`DONE`，再解锁下游，不让两人同时写锁定路径。
- [ ] 最终独立 QA 覆盖真实用户可操作、视觉、三语、权限、目录、价钱、库存和修订，运行 `node --test tests/architecture.test.mjs` 与 `pnpm validate`，报告准确 PASS/FAIL。
- [ ] 产品所有者核对实际页面截图并确认最终结果；此前不宣称全站完成，也不自行推送或部署。
