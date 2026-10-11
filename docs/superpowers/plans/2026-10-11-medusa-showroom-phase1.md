# 玄矶 Medusa 精选展示网站 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` task-by-task. Steps use `- [ ]` checkboxes. Product Owner approved this Phase 1 plan on 2026-10-11; a worker may edit only after its own row is registered and `IN_PROGRESS` in `docs/tasks/TASK_REGISTRY.md`.

**Goal:** 复用 Medusa 的成品商业内核，建设中国大陆与台湾地区的玄矶精选展示、设计师与系列页面，并保留全部现有 AI、DIY、塔罗、Oracle 与知识库体验；本阶段不启用购买。

**Architecture:** Medusa 是成品 Product/Variant/Collection/Price/Inventory 的唯一写入权威，使用与现有 Prisma 数据隔离的服务及数据库。玄矶只增加品牌/设计师署名、版本化授权、媒体来源、三语审校与失败关闭的公开读取闸门；Next.js 页面消费闸门输出，绝不直读未过滤的 Store API。DeepSeek 负责内核接入、合同和服务端闸门；Qwen 负责既有设计系统内的展示组件及页面；SOL 负责登记、独立审查与集成，不写运行时代码。

**Tech Stack:** Medusa `2.21.2`（隔离 PoC 已测版本；安装前仍须复核官方版本/许可/运行时）、现有 Node 22+/pnpm 11、TypeScript、PostgreSQL、Next.js 16、React 19、Zod、Node tests 与项目浏览器 QA。

**Spec:** [自营精选网站中文规格](../specs/2026-10-10-curated-showroom-site-design.md)；选型权威是 [`DEC-COMMERCE-001`](../../DEPENDENCY_DECISIONS.md)。证据候选为 `TASK-COMMERCE-OSS-FIT-001@97428aa` 与 `TASK-COMMERCE-BENCH-001@b5c1627`；两份候选在独立工作树，不能把未合入文档误称为当前 `main` 文件。

## Global Constraints

- 每项实施前 SOL 独立登记唯一 ID、唯一 owner、`task/<task-id>-<slug>` 分支、专用工作树、精确可写/禁止路径、依赖与验收；本计划的路径是登记候选，不自动获得写权限。共享合同、根配置与 Prisma 文件必须由明确任务单独持有。一个模型不得同时持有两个 `IN_PROGRESS` 任务。
- Product Owner 批准的是 Medusa 选型与视觉方向，不是支付、生产部署、真实无野商品发布或现有设计订单迁移。缺真实图片、逐件授权、审校文案或人工确认价时，正式页面只能显示诚实空态；测试 fixture 不得进入公开运行时。
- 市场 `CN`/`TW` 与显示语言 `zh-CN`/`zh-TW`/`en-US` 分离；CN 仅人工 CNY，TW 仅人工 TWD，不自动换汇。公开列表、详情、首页推荐和 SEO 的可见性必须由同一个服务端发布谓词决定；内核默认的缺译回退、缺价可见和缺图可见不可直接暴露。
- 成品内核绝不回写 `Crystal`、`MaterialProduct`、`AccessoryProduct`、`DesignV1`、`DesignRevision`、`OrderDesignSnapshot`。从成品到普通 DIY 的入口仍是空托盘；未经独立授权合同，不把原款复制为消费者设计。Medusa 内置订单/支付能力不等于本阶段已启用。
- 视觉采用已确认的克制东方当代珠宝方向：暖纸色、深墨色、少量黄铜细节，首页主标题“让天然石，成为你的表达。”；首页同时看得到精选作品与自己创作，保留塔罗和星台各自入口。效果图是布局参考，不是商品、价格、设计师肖像或授权素材。旧 DIY 桌面三栏、手机上托盘下材料、空托盘首珠及 8–60 珠规则不得被商城版式重写。
- 每任务先 RED 再 GREEN，保留失败原因、最小实现、目标测试、typecheck/lint/build、`node --test tests/architecture.test.mjs`、`CI=1 pnpm validate`、`git diff --check` 真实输出；环境既有失败须在未改基线复现并单列，不可报为全绿。Conventional Commit；未经单独授权不合并 `main`、推送或部署。

## 一期公开 URL 与读取决定

- 稳定公开路径为 `/shop`、`/shop/products/[slug]`、`/designers/[slug]`、`/collections/[slug]`；市场通过显式 `?market=CN|TW` 选择，默认 `CN`，并贯穿所有内部链接与 canonical。非法市场失败关闭或明确重定向到 CN，不得以用户语言猜测市场。
- 继续使用现有 `mystcrag_locale` cookie/`LocaleProvider` 驱动 `zh-CN`、`zh-TW`、`en-US`，无语言 URL 前缀；服务端首屏和元数据取同一已校验语言。切语言刷新展示数据，不发任何设计创建/保存请求，也不切市场/币种。本阶段不声称三种语言都可分别被搜索引擎索引，不发布未经验证的 `hreflang`。
- 玄矶公开页面只能通过**服务端**读取已批准闸门的响应；不把 Medusa Admin token、Store publishable key、Authing token 或登录 cookie 送到浏览器/无过滤 Store API。动态商品数据暂用 `no-store`，直到独立缓存失效任务证明授权撤回可立即生效。详情不合格返回 404，上游故障返回明确服务错误，不能退回未经审批的 Medusa 原生响应。

## Review Focus

1. 原生 `/store/products` 仍能返回缺译/缺价/缺图商品时，**玄矶公众路径必须 404/排除**；Task 3 的负例测试与 Task 8 的网络绕过测试负责证明，不能只测前端隐藏。
2. `zh-TW + CN` 必须保持经批准的 CNY，`zh-CN + TW` 保持经批准的 TWD；Task 2 合同测试、Task 3 服务测试和 Task 5 页面测试各固定一组交叉断言。
3. 授权过期、撤回、媒体撤回或 Medusa 不可用时，列表、详情、首页和元数据同步失败关闭；Task 3/8 覆盖，同一内容不能一处可见一处不可见。
4. 空库、零真实无野素材与长三语文案下，页面不出现假商品/价格/库存/购买 CTA，也不溢出；Task 4/5/6/8 覆盖 320、390、768、1440 与 200% 缩放。
5. 无论从商品、首页还是导航进入普通 DIY，仍走历史选择/全空新草稿与现有权限门；Task 7/8 复验，不得复制原款或发隐式设计创建请求。

## 依赖与并行路线

| 顺序 | 候选任务 / 唯一 owner | 依赖及并行规则 | 登记时可写路径候选 |
| --- | --- | --- | --- |
| 0 | `TASK-COMMERCE-OSS-SELECT-001` / SOL | 本决策与计划；完成并集成后才允许运行时任务开工 | 仅本任务已登记的文档路径 |
| 1 | `TASK-COMMERCE-MEDUSA-BASE-001` / DeepSeek | Task 0 审批与文档基线；只接入隔离内核、无真实商品 | 新 `apps/commerce/**`、`pnpm-lock.yaml`、`docs/DEPENDENCY_DECISIONS.md` 的版本补记；如确需根配置，先逐文件扩展登记 |
| 2 | `TASK-COMMERCE-PUBLIC-CONTRACT-001` / DeepSeek | Task 1 对官方模型的实际验证；先于所有公开消费者 | 新 `packages/design-contract/src/schemas/showroom.schema.ts`、相邻测试、`packages/design-contract/src/index.ts`、`docs/API_SPECIFICATION.md` |
| 3 | `TASK-COMMERCE-GATE-001` / DeepSeek | Task 2 合入；Medusa 模块/公开投影与 fail-closed 负例 | `apps/commerce/src/**` 中逐文件列明的授权/审校/媒体/闸门/路由、相邻测试、`docs/API_SPECIFICATION.md` 与必要运营说明；不接触既有 Prisma 商品表 |
| 4，可与 1–3 的**不同模型**并行 | `TASK-COMMERCE-FE-VISUAL-001` / Qwen | 视觉对标候选获 Product Owner 确认；只建可测试的展示组件与空态，不挂生产商城路由、不请求未冻结 API | 新 `apps/frontend/src/features/showroom/components/**`、相邻测试、新 `apps/frontend/app/styles/showroom.css`；不写首页、导航、DIY 或共享 token |
| 5 | `TASK-COMMERCE-FE-CATALOG-001` / Qwen | Task 2/3/4 合入；只接单一闸门 DTO，先目录和详情 | 新 `apps/frontend/src/lib/api/showroom-api.ts` 及测试、新 `apps/frontend/app/shop/**`、Task 4 展示组件与 `showroom.css` 的串行续写 |
| 6 | `TASK-COMMERCE-FE-STORY-001` / Qwen | Task 5 合入；设计师/系列，复用 API/CSS，禁止与 Task 5 同时写 | 新 `apps/frontend/app/designers/**`、`app/collections/**`、Task 4/5 的 showroom 文件及相邻测试 |
| 7 | `TASK-COMMERCE-FE-SHELL-001` / Qwen | Task 6 合入且星台首页/导航共享文件解锁；首页、页眉/手机导航、三语文案 | `apps/frontend/app/page.tsx`、`app/navigation.ts`、`app/layout.tsx`、`components/mobile-bottom-nav.tsx`、三份 `src/i18n/messages/*.ts`、必要的 `star-content.css`、相邻 shell 测试；逐文件锁定 |
| 7A，真实内容依赖 | `TASK-COMMERCE-MEDIA-001` / Qwen（ASSET） | 产品所有者交付逐图来源/授权/批准版后方可领取；可与 Task 5–7 的不同路径并行 | 新 `apps/frontend/public/showroom/wuye/**` 与逐件来源清单、只读资产测试；缺素材则 `BLOCKED`，不得拿效果图代替商品照 |
| 7B，真实内容依赖 | `TASK-COMMERCE-CONTENT-001` / DeepSeek | Task 3 和 7A 验收且产品所有者确认三语审校/双市场人工价/授权版本；复用 Medusa Admin 能力录入 | 经核准内容清单、官方 Admin 导入/人工录入配置、相邻幂等/撤回测试与操作文档；精确路径在登记时冻结，无资料则 `BLOCKED` |
| 8 | `TASK-COMMERCE-QA-001` / DeepSeek（QA） | Task 3–7 与星台剩余任务完成；真实内容发布 PASS 还需 7A/7B；浏览器/隔离数据库/授权与发布门 | 指定 `scripts/ui-qa` 新脚本及测试、`docs/INTERACTION_TEST_PLAN.md`、忽略的 QA 证据目录；不改生产逻辑 |

Task 4 之所以可并行，是因为它只接收纯展示 props、只用测试 fixture 与真实空态，不定义第二套 API DTO、也不创建可被索引的假商品页面。Task 5 负责用 Task 2 的唯一公共 DTO 接线。无野真实图片、逐件授权、三语审校与双市场人工价走 7A/7B；缺料不阻断 Task 4 的空态和组件测试，但阻断真实商品发布及 Task 8 的完整发布验收。

### Task 1 — 隔离 Medusa 基座（DeepSeek）

**Files:** 首选官方 scaffold 下 `apps/commerce/package.json`、`apps/commerce/medusa-config.ts`、`apps/commerce/src/**`、`apps/commerce/tests/isolation.test.ts`；`pnpm-lock.yaml` 和 `docs/DEPENDENCY_DECISIONS.md` 仅在精确注册后可写。官方 scaffold 的文件清单若不同，先返回 SOL 修订路径再动手。

**Interfaces:** 产出稳定的内部 Medusa Admin/Store 启动方式及隔离 `COMMERCE_DATABASE_URL`，不向现有 Authing、Fastify 或 Prisma 输出类型。暂不公开用户可达商城路由。

- [ ] 写失败的隔离测试：错误/缺失 DB URL 不会回退到现有 `DATABASE_URL`；未配置时不接用户库；Medusa 默认 Store 路径不经玄矶公众域名暴露。记录 RED。
- [ ] 固定被 PoC 测过的 `2.21.2` 或提供差异复核；核对官方 MIT/企业版边界、Node 版本、精确锁文件依赖与已知安全风险，先确认是否需要新增根配置文件并申请登记。
- [ ] 仅在独立测试数据库中完成官方迁移、虚构 Product/Variant/Collection 与 CN/TW 两条人工 region-rule 价格的冷启动/重启探针；无真实无野素材、无购物车/支付配置。
- [ ] 测试 GREEN：模块测试、Medusa 启动/退出及用户库零写入证据、`pnpm --filter @mystcrag/commerce typecheck`（包脚本应存在）、架构、validate、diff check；交付精确版本/命令/回滚证据与 Conventional Commit，供 SOL 审查。

### Task 2 — 唯一公开 DTO（DeepSeek）

**Files:** 表中四项 Contract/API 文件；不改 `DesignV1`、材料与旧订单 DTO。**Produces:** `ShowroomMarket = "CN" | "TW"`、`ShowroomLocale = "zh-CN" | "zh-TW" | "en-US"`、`ShowroomPublicProduct`、`ShowroomPublicCollection`、`ShowroomPublicDesigner`、`ShowroomPage<T>`，以及验证市场/语言/价/公开版本的 Zod schema；最终导出签名与错误响应在 `API_SPECIFICATION.md` 冻结后才让 Task 3/5 消费。

- [ ] RED：缺市场/语言、TW 非 TWD、负值或不安全整数价格、内部成本/私人设计字段混入、失效授权及缺审校/媒体/价均被拒；交叉市场语言不串价。
- [ ] GREEN：只实现公众只读 DTO 与解析器，固定列表/详情及 400/404/上游故障语义；运行 Contract 测试、typecheck、架构、validate 与 diff check。
- [ ] Conventional Commit 与 SOL 独立审查后，作为 Task 3/5 唯一合同权威；不得在 frontend 或 Medusa route 重新发明同名 DTO。

### Task 3 — 玄矶最薄发布闸门（DeepSeek）

**Files:** Task 1 确认后的 Medusa 官方扩展目录中的授权/媒体/翻译/价格审核记录与只读公众投影文件及相邻测试；具体文件名先据官方 scaffold 写入注册表。修改 `docs/API_SPECIFICATION.md` 与审核/撤回操作文档必须同任务登记。

- [ ] RED：对真实 Medusa Store 返回的缺译回退、缺价 null、缺图、草稿/撤回/过期授权/地区不符与上游断线，公开列表不出现、详情返回 404 或明确服务错误；原生 Store 直访不能绕过公众入口策略。
- [ ] GREEN：只读投影复用 Medusa Product/Variant/Price/Collection 与真实管理状态；玄矶扩展只记录 `productId` 关联的版本化授权（地区/期限/允许展示及修改范围）、批准媒体的来源/校验和/撤回、三语文本版本/审校及价格行版本/金额/币种/region-rule 的人工批准指纹，不再持有另一套可编辑商品或金额。价格或译文在 Medusa Admin 被改动但未重新审批时，原批准指纹失效，公开读取立即关闭。所有公开页使用同一谓词；后台改变任一批准状态后读取立即更新或以可证明的失效机制一致撤回。
- [ ] 测试 CN/TW×三语、审计/撤回/重复导入、无内部成本/私人设计泄漏；隔离库集成测试、模块测试、typecheck、架构、validate、diff check。不得新建平行 Prisma 成品表、订单或支付 API。

### Task 4 — 不依赖商业 API 的视觉组件（Qwen；与 DeepSeek Task 1–3 并行）

**Files:** `apps/frontend/src/features/showroom/components/showroom-card.tsx`、`showroom-empty-state.tsx`、`showroom-editorial-section.tsx` 及相邻测试；新 `apps/frontend/app/styles/showroom.css`。确需其他文件时先让 SOL 扩展登记。

- [ ] RED：320/390/1440 宽商品卡、真空态、图片缺失、简繁英长文本、价格/地区作为显式 props、键盘与 `prefers-reduced-motion` 断言先失败；零商品时无购买 CTA 或占位假卡。
- [ ] GREEN：复用现有 `StarSurface`/`InstrumentButton`/语义 token；卡片和编排只读 props，不抓 API、不复制设计师原款、不引入第二套组件库。效果图仅作构图参考，用户批准的原始入口素材保持来源不变。
- [ ] 以 `TASK-COMMERCE-BENCH-001` 对标文档与本规格核对 44 px、AA、首屏可见下一段、无脏纹/冗余星轨；跑组件测试、前端 typecheck/lint/build、架构、validate、diff check，提交 320/390/1440 截图。无真实无野资产则仅交真实空态截图，不伪造商品页上线。

### Task 5 — 精选目录与商品详情（Qwen）

**Files:** 新 `apps/frontend/src/lib/api/showroom-api.ts`、`showroom-api.test.tsx`、`apps/frontend/app/shop/page.tsx`、`apps/frontend/app/shop/products/[slug]/page.tsx`，以及 Task 4 的组件、相邻测试与 `apps/frontend/app/styles/showroom.css`。**Consumes:** Task 2 的唯一公开 DTO 与 Task 3 的失败关闭读取入口。

- [ ] RED：测试 `CN`/`TW` URL 与人工币种、交叉语言/市场、空结果/上游错误/详情 404、未发布商品不入列表与元数据、无登录访问、无浏览器 token/cookie 转发；目前缺路由/客户端应真实失败。
- [ ] GREEN：服务端只调玄矶闸门，验证 DTO；筛选/排序写 URL、切市场重取且保留语言，切语言刷新且保留市场/价格。展示真实材料、尺寸、署名和咨询/暂未开放状态，不出现购物车/支付。
- [ ] 运行相邻测试、前端 typecheck/lint/build、架构、validate、diff check；实浏览器看 320/390/768/1440 与 200% 缩放、三语×两市场，提交可对照截图。只提交本任务文件，SOL 审查后才解锁 Task 6。

### Task 6 — 设计师与合作系列（Qwen）

**Files:** 新 `apps/frontend/app/designers/[slug]/page.tsx`、`apps/frontend/app/collections/[slug]/page.tsx`、`apps/frontend/src/features/showroom/components/showroom-designer.tsx`、`showroom-collection.tsx` 及相邻测试；Task 5 的 `showroom-api.ts`、测试和 `showroom.css` 仅限追加必要的只读方法/样式。**Consumes:** Task 3/5 的单一公开投影。

- [ ] RED：缺真实身份/合作资料、未批准作品、撤回与过期授权、另一市场不可见、404 与上游失败必须分开；没有肖像/故事时不得捏造。
- [ ] GREEN：按核准身份、作品/系列与地区构图；无野真实内容不足时显示“筹备中”和真实可用入口，绝不生成假肖像、伪造 SKU/库存或暗示可结算。
- [ ] 运行相邻测试、前端 typecheck/lint/build、架构、validate、diff check 与 320/390/1440 截图；只提交登记文件，SOL 审查后才解锁 Task 7。

### Task 7 — 首页、导航与三语整合（Qwen）

**Files:** `apps/frontend/app/page.tsx`、`app/navigation.ts`、`app/layout.tsx`、`components/mobile-bottom-nav.tsx`、`src/i18n/messages/zh-CN.ts`、`zh-TW.ts`、`en-US.ts`、必要的 `app/styles/star-content.css`、相邻 shell 测试。**Consumes:** Task 3/5/6 公开投影；共享文件须等星台任务验收并解除锁。

- [ ] RED：首页首屏无法同时发现精选作品和创作入口、照片上下空带、丢失塔罗/Oracle/AI/DIY/画廊、三语长文本溢出、语言切换改变市场/价格或入口触发隐式设计 POST 时测试失败。
- [ ] GREEN：首页 H1 固定“让天然石，成为你的表达。”，使用经批准的原始入口素材与审查过的排版规则；无已发布商品时呈现真实筹备中叙事。页眉/手机导航保留三语切换与显式市场选择，SEO title/description/canonical 与市场一致，不发布未验收 `hreflang`。
- [ ] 浏览器检查 320×568、390×844、768×1024、1440×900、1440×560、200% 缩放、44 px 触控、AA 和减少动效；跑 shell/导航测试、前端 typecheck/lint/build、架构、validate、diff check。独立提交与审查，不自动合并。

### Task 7A/7B — 真实无野素材与内容（单 owner、先核收后录入）

- [ ] **7A / Qwen ASSET：** 产品所有者提供逐图授权范围、作品/版本/作者关联、来源与原始文件后，先算 SHA-256 并核对文件身份、尺寸、地区、期限、展示/修改权限；只把批准文件与来源清单放入登记的 `public/showroom/wuye/` 路径。写资产测试排除未登记文件和模拟图，验证手机/桌面裁切不伤作品主体。缺任何必要来源则记录 `BLOCKED`，不生成替身商品照。
- [ ] **7B / DeepSeek：** 从产品所有者签字/确认的商品、规格、授权版本、审校三语文本和 CN/CNY、TW/TWD 人工价格清单，优先经 Medusa 官方 Admin 录入/导入。RED 测试证明同版本重放不复制 SKU、未审批更改会撤回公开可见性、授权到期/媒体撤回传播；GREEN 后做 dry-run、正式导入、回滚/撤回演练，保留审计证据。无清单则 `BLOCKED`，不得写虚构 seed 或假库存。
- [ ] 两任务分别跑自己的窄测、架构、validate、diff check 和真实媒体/内容清单复核；仅 Task 7B 经发布闸门核准后，Task 8 才可把“真实无野作品已展示”标为 PASS。

### Task 8 — 独立浏览器与发布闸门（DeepSeek QA；SOL 终审）

- [ ] 在隔离库录入**明确标为测试**的虚构内容，验证公开闸门所有失败关闭分支、撤回传播、原生 Store 旁路不可公网达、CN/TW×三语与跨组合价格；浏览器分别测 320×568、390×844、768×1024、1440×900、1440×560 和 200% 缩放。
- [ ] 测全站首页/目录/详情/设计师/系列空态及实数数据；回归 AI/DIY/塔罗/Oracle/矿石库/画廊、DIY 历史选择/全空新草稿/权限与 8–60 珠。日志中不能有购买成功假象、浏览器错误或未授权素材。
- [ ] 如尚缺无野真实图片、逐件授权、审校三语或双市场人工价，记录“展示框架通过、真实上架 BLOCKED”；不得把虚构 QA 数据带入生产或把网站整体宣称上线。QA 证据、架构、validate、diff check 由 SOL 独立复核，失败由原 owner 按精确复修单处理。

## 未解锁事项与回滚

真实无野作品发布需另登记媒体/授权/内容导入任务并由 Product Owner 逐件确认；无图时设计师和系列页只显示真实关系与筹备状态。支付、税费、退款、物流、生产部署、白牌、小程序、3D 及由设计师原款生成可追溯衍生设计，均非本计划完成条件。Task 1–4 的回滚应只移除新隔离服务/未挂载组件，不触及既有 Prisma 数据；Task 5–7 回滚是撤下新公开路由/导航并保持旧创作入口可用。任何真实内容发布后的回滚先撤回公开状态并保留授权、媒体与审核记录。
