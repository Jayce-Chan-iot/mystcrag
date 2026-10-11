# 玄矶自营精选网站 OSS-first Phase 0 Plan（选型阶段归档）

> 2026-10-11 handoff: Product Owner selected Medusa after `TASK-COMMERCE-OSS-FIT-001@97428aa` and confirmed the restrained showroom visual direction after `TASK-COMMERCE-BENCH-001@b5c1627`. This document remains the Phase 0 evidence and constraint record. The selected-engine Phase 1 sequence is [the Medusa showroom plan](2026-10-11-medusa-showroom-phase1.md); do not dispatch historical self-built Contract/Prisma/Fastify alternatives. The cited PoC and visual report remain separate candidates until explicitly integrated.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` task-by-task. Steps use `- [ ]` checkboxes. This plan is not authorization to change production code, install dependencies, migrate data, merge, push, or deploy.

**Goal:** 先验证成熟开源电商内核，再以最少的玄矶专有扩展完成大陆／台湾自营精选展示，保留现有 AI、DIY、知识库、Tarot、Oracle 与星台视觉成果；没有支付和真实商品资料时不假装能够下单。

**Architecture:** 玄矶现有 Next.js 继续作为独立店面，已有 DesignV1、DesignRevision、DIY 材料与订单快照保持原权威。成品的商品、规格、系列、区域价、库存、管理与未来订单优先选用一个成熟开源内核；设计师署名、授权版本、媒体来源和严格发布闸门才考虑薄扩展。选型实证和 Product Owner 决策之前，**不得**照旧计划新建 `ShowroomProduct/Variant/Listing` Prisma 表、固定六个 Fastify GET 或平行订单体系。

**Tech Stack:** 现有 TypeScript、Next.js 16、React 19、Fastify、Prisma/PostgreSQL 与 pnpm 11；候选为 Medusa、Vendure、Saleor，最终依赖、版本与部署拓扑必须通过选型闸门后冻结。视觉任务仍复用玄矶现有组件，按需评估 Radix/Embla；Vercel Commerce 只作店面参考，不作商品后端。

**Spec:** [Product Owner 已批准的 OSS-first 中文规格](../specs/2026-10-10-curated-showroom-site-design.md)。当前只批准 Phase 0 的选型与排版对标，Phase 1 实施须选型实证及新的子计划获批。未完成 UX 继续由[星台两模型执行计划](2026-10-03-star-execution-dispatch.md)及其详细计划控制；[DIY 60 颗上限计划](2026-10-10-diy-60-bead-cap-implementation.md)独立控制自身路径。

## Global Constraints

- 每个执行任务先按 `docs/tasks/TASK_REGISTRY.md` 登记唯一 ID、owner、`task/<task-id>-<slug>` 分支、独立工作树、精确可写/禁止路径和验收标准，并标 `IN_PROGRESS`；下文 ID 只是候选，不预占锁。DeepSeek 负责后端/集成与 OSS 技术验证，Qwen 负责页面对标与前端，SOL 只登记、审查、派发和验收，不写运行时实现。
- 每项功能/页面族开工前有中文对标卡：当前生产路径与同视口截图、实际打开的竞品/优秀独立站 URL 和日期、具体排版/交互、适用开源项目的维护/许可证/版本兼容、采用/拒绝理由及可回归断言。不得复制竞品作品、图片、文案或授权不明代码。
- 保留玄矶桌面 DIY 三栏、手机上托盘/下材料、空托盘首珠、真实珠径/透明线、三语显示、Oracle/Tarot 文化体验边界。首页“精选作品”与“自己创作”并列，不能变成只有观星问卦。共享首页、导航和 CSS 的星台任务未解锁前，不得领取相关商业页面任务。
- CN 与 TW 是市场，分别只展示人工确认的 CNY 与 TWD 价格；`zh-CN`、`zh-TW`、`en-US` 是语言，切语言不得换市场、汇率、设计或价格。缺区域授权、批准图片、三语审校、人工价格、发布批准之一，服务端拒绝公开；不能依赖前端隐藏或开源内核的默认翻译回退。
- 首期只有真实展示和明确的咨询/暂未开放状态。没有真实供货、支付、税务/配送决策时，不出现“现货”“加入购物车”“支付成功”等承诺；白牌、小程序、生产 3D、支付申请、统一商业订单与生产部署留待独立规格。
- 文档任务运行架构测试、内部链接检查、`git diff --check` 和可运行时的 `CI=1 pnpm validate`；实现任务按 TDD 保留 RED→GREEN 证据、目标测试/类型/构建、架构、validate 与真实浏览器结果。不把 baseline 失败写成 PASS，不削弱断言或制造假商品。Conventional Commits；无授权不合并、推送或部署。

## Review Focus

1. **双重商品权威：** 选择任一内核后，玄矶 Prisma 不再另有可编辑的同一成品 `Product/Variant/Price/Order`；测试同 SKU/版本只有一个写入源，撤回跨所有公开入口一致。
2. **缺资料与翻译回退：** 官方 Store API 或翻译模块返回草稿、缺译、过期授权、缺图、缺市场价时，玄矶公开列表与详情都不得泄露；测试失败关闭而非使用源语言兜底。
3. **市场/语言交叉：** `zh-TW + CN` 仍是经批准的 CNY，`zh-CN + TW` 仍是经批准的 TWD；切语言不自动换汇或发创建/保存 POST。
4. **既有创作边界：** 从原款跳转普通 DIY 时仍是空托盘，未经另行授权合同不得复制原款珠序；原有 DesignRevision、材料 SKU、订单快照不被电商内核迁移或覆盖。
5. **视觉与可访问性：** 320×568、390×844、768×1024、1440×900、1440×560、200% 缩放下三语长文案、真实价格、导航和图片不溢出，44 px 触控、AA 对比、键盘与减少动效通过；无素材时展示诚实空态。

---

## Phase 0：先选型，后冻结合同（唯一可先派发的商业任务）

### Task 0A — 开源电商内核适配与隔离 PoC（DeepSeek；候选 `TASK-COMMERCE-OSS-FIT-001`）

**Files:** 新建 `docs/superpowers/benchmarks/2026-10-10-commerce-engine-fit-gap.md`；抛弃式 PoC 仅在明确记录的仓库外临时目录，输出日志/截图置于忽略的 `output/playwright/task-commerce-oss-fit-001/`，不得提交生成项目。执行前 SOL 需在注册表写明该文档、证据目录和临时目录边界。不得改 `apps/**`、`packages/**`、Prisma、root manifests/lockfile、环境密钥或用户数据。

**Interface / handoff:** 输出同一张有来源 URL、核验日期、精确版本与复现实验的 Medusa／Vendure／Saleor 适配矩阵和单一首选／备选建议；字段至少覆盖许可证及企业版边界、维护、Node/TS/DB/部署、Admin、Product/Variant/Collection、价格/区域/渠道、库存、翻译与缺译行为、发布/撤回、公开 API、扩展点、DIY/既有订单隔离、未来支付适配未知项、迁移/退出和运维成本。

**硬性通过条件：** 商业使用许可证经核验；商品/规格/系列和 CN/CNY、TW/TWD 人工价有唯一权威；管理端可录入与撤回；公开入口能以实测的原生能力或薄服务器扩展对缺译、缺授权、缺图、缺价、撤回一律失败关闭；不迁移或写入现有 DIY/设计/订单；运行时与独立站集成可在隔离环境复现。任一项未证实即不标 PASS，转试下一候选。通过者之间再以扩展代码量、运维/数据库复杂度和退出成本比较，不能按星数直接选。

- [ ] **Step 1 — Baseline:** 只读确认最新 `main`、活跃任务锁、现有材料/设计/订单生产权威及 Node/pnpm 版本；记录版本/官方文档/许可证的证据 URL 与观察日期，不凭 stars 或 README 推断功能完成。
- [ ] **Step 2 — Comparator:** 对三候选逐项填“原生支持／可扩展／需自建／未证实”；对 Medusa 单独核查 Translation beta 缺译回退与 Node 运行版本，对 Vendure 核查 GPLv3/商业双许可，对 Saleor 核查 Python/GraphQL 与现有栈的集成成本。不能核实的列为风险，不填 PASS。
- [ ] **Step 3 — Throwaway probe:** 先验证推荐候选可在支持的运行时启动，再用虚构商品/规格分别录入 CN/CNY、TW/TWD 人工价格及三语标题；从独立店面/公开 API 读取。故意缺 zh-TW、授权、图片、TW 价并撤回发布，记录内核原生行为及所需最薄服务器端发布闸门；不能直接满足就如实 FAIL，不把 PoC 补丁冒充内核能力。测试管理录入、去重更新、只读公开路径和系统停机/恢复，不接玄矶真实数据库或真实无野内容。
- [ ] **Step 4 — Decision evidence:** 给出唯一数据权威和 ID 映射图、保留既有 Design/Material/Order 的隔离边界、引入服务/数据库/缓存的运维成本、未来支付插件仅作为待验证项、许可证复核、回滚/退出。若首选不合格，按同一最小样例试备选；仅三个候选都有可复现阻断时提交“最小自建展示目录”例外申请，且不得包含新订单系统。
- [ ] **Step 5 — Verify and submit:** 文档所有来源能打开，PoC 命令/版本/预期与实际结果可复现；`node --test tests/architecture.test.mjs`、内部链接检查、`CI=1 pnpm validate`（可运行时）、`git diff --check`。只提交登记文档，`docs(commerce): evaluate open-source commerce cores`；SOL 审证据，Product Owner 选择/否决。**未通过审批时 Phase 1 维持 BLOCKED。**

### Task 0B — 竞品、优秀独立站与开源店面排版对标（Qwen；候选 `TASK-COMMERCE-BENCH-001`）

**Files:** 新建 `docs/superpowers/benchmarks/2026-10-10-curated-showroom.md`；截图只到忽略的 `output/playwright/task-commerce-bench-001/`。与 0A 路径不重叠；Qwen 若仍占用 `TASK-UX-BRACELET-FE-001`，先等该任务释放。

- [ ] **Step 1 — Baseline:** 首页及现有相关路由记录生产路径、1440×900/390×844 截图；目录、详情、设计师/系列不存在就写“缺失”，不能画成已上线。
- [ ] **Step 2 — Compare:** 每种品牌叙事、商品判断、操作工作台页面至少实际打开一处同类竞品/优秀独立站并记录日期、内容次序、图片占比、文字密度、导航、手机重排；对可复用 UI 开源组件核实许可证/兼容性，明确为何不照搬竞品图文。
- [ ] **Step 3 — Visual output:** 提交 320、390、1440 宽的页面族线框/静态效果，逐条标采用／改造／拒绝理由；保持克制、清晰对比、真实作品与既有 DIY 版式，不凭假商品撑版。
- [ ] **Step 4 — Verify and submit:** 路径/截图、44 px/AA/减少动效检查、架构测试、内部链接检查、可运行时 validate、diff check；只提交登记文档，`docs: benchmark curated showroom layouts`。SOL 审图并请 Product Owner 确认后才可实施页面。

### Task 0C — 选型审批与实施合同重写（SOL；0A 验收后即可登记）

**Files:** 未来任务登记时逐项列明 `docs/DEPENDENCY_DECISIONS.md`（唯一 OSS 选型决策）、`docs/governance/CANONICAL_COMPONENTS.md`（成品唯一权威）、本规格/本计划的选定拓扑与 `docs/tasks/TASK_REGISTRY.md` 目标行；如需 API/数据库契约，另由 DeepSeek 的 Contract 任务拥有其控制文档。此行不提前锁文件。

- [ ] **Step 1 — Review:** SOL 独立复验 0A 来源、许可及 PoC 的通过/失败；写一页“选/不选/不确定”的方案比较及运维、回滚成本，请 Product Owner 明确批准所选内核或有证据的最小例外。0B 的视觉确认是前端页面开工门，不阻断技术选型。
- [ ] **Step 2 — Freeze:** 在获批后仅登记唯一成品商品写入权威、玄矶扩展实体、公开发布闸门、管理审批/审计、ID 映射和版本/退出策略。冻结精确包版本、支持的 Node 版本与依赖决策；尚未获批的内容写 BLOCKED，不标已实现。
- [ ] **Step 3 — Re-plan:** 按获批内核实际 API/扩展点写 Phase 1 的可执行子计划和精确文件/接口/测试/可写路径；原 Task B/C/D 的“自建 Prisma 商品表＋六 GET”不是默认候选，**不得直接派发**。运行文档/架构/validate/diff 检查，再请 Product Owner 审批实施子计划。

## Phase 1：条件任务图（需 0C 获批后才能细化与派发）

| 顺序与单 owner | 成果与不能造的轮子 | 放行验收／风险 |
| --- | --- | --- |
| 1. DeepSeek：依赖与基础集成 | 接入获批内核或其隔离服务；复用 Product、Variant、Collection、区域价、库存、Admin/Store API。不复制成第二套玄矶 Prisma 商品/订单权威。 | 冻结版本、许可证/安全、支持的 Node/DB、安装与启动、单商品双区域价，断线/恢复；可卸载/退出。任何 package/config 文件先登记。 |
| 2. DeepSeek：玄矶薄扩展与公开投影 | 仅实现获批内核没有的署名/授权版本/媒体来源与“缺项不公开”服务端闸门；精确方案可能是内核模块/工作流/元数据加只读投影，**不预设** Fastify 六 GET 或同步表。 | 草稿、撤回、授权过期、缺译/缺图/缺价格在列表和详情一致不可见；成本/私有设计不泄露；管理动作可审计。Contract/API/数据库文档同变更更新。 |
| 3. Qwen/ASSET：真实无野素材；DeepSeek：批准内容录入 | 逐图来源、授权、SHA 与真实三语审校/两市场人工价格经 Product Owner 确认后，走获批内核的管理/导入能力；不自建默认 Prisma seed。 | 缺资料 BLOCKED；dry-run、幂等重放、撤回、旧版本审计；不得造产品/库存/订单。素材路径与内容路径串行或不重叠登记。 |
| 4. Qwen：目录/商品详情；再设计师/系列 | 0B 视觉方案经 Product Owner 确认后开工；保留 Next.js、现有 i18n/视觉 token，读唯一公开发布投影；`/shop`、`/shop/products/[slug]`、`/designers/[slug]`、`/collections/[slug]` 的真实空态/错误/区域价。 | 三语×双市场、404/网络故障、不转发用户 token、无假购买 CTA，320～1440/200%/键盘/AA/减少动效截图；各页面族单 owner 串行共享 API/CSS。 |
| 5. Qwen：首页/导航整合；DeepSeek QA：独立整站门 | 星台共享路径解锁后再把精选/创作双入口接入，保留 AI/DIY/Tarot/Oracle/画廊；QA 同时复验旧路径与新授权闸门。 | 未经发布的商品不进首页；真实浏览器 CN/TW×三语、六视口、DIY 历史/空托盘/权限、Oracle 一键问卦、Tarot、浏览器错误与所有合同测试；失败由原 owner 复修。 |

Phase 1 每项在 0C 后单独登记精确文件、接口、RED 测试和 GREEN 命令；选型前列虚构文件名或包版本会误导执行者。0A 与 0B 可以并行且只写各自文档；DeepSeek 不可在 0A 还没获批时抢做 Contract/Database/Backend。缺授权素材/价格只阻断真实发布，不以假种子阻断页面组件的测试 fixture 开发；但全站目标不得在真实内容或浏览器 QA 缺证据时标 DONE。

**与未完成星台任务的关系：** 以注册表和最新代码为准，先接收 `TASK-UX-BRACELET-FE-001` 的真实验收，再按[手串工作台计划](2026-10-03-star-bracelet-workbench.md)、[问卦结果计划](2026-10-03-star-oracle-result-experience.md)、[页面视觉 QA 计划](2026-10-03-star-page-family-visual-qa.md)继续其未完成部分；[60 颗上限计划](2026-10-10-diy-60-bead-cap-implementation.md)仍是独立合同。任何候选提交不能仅凭聊天中的“已完成”视为 main 生产功能。共享文件锁释放前 Phase 1 第 5 项不得开始。

## 非本计划交付

成品/定制统一下单与支付、退款、履约/物流、库存预留并发安全、服务商申请、税务/配送、白牌、小程序、实验性/生产 3D、正式部署，以及从设计师原款生成带授权追溯的消费者衍生设计，均须后续独立规格/注册任务。选中电商内核内置这些模块，只表示可复用候选能力，不表示玄矶已经启用或完成其商业合规与验收。
