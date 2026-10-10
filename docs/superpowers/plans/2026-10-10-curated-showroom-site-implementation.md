# 玄矶自营精选网站 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL：逐任务使用 `superpowers:executing-plans`（或可用时的 `superpowers:subagent-driven-development`）；以 `- [ ]` 记录 RED、GREEN、验证和提交。本文是待产品所有者审阅的实施计划，**不是**任何运行时代码或数据库变更的开工授权。

**Goal / 目标：** 在保持 AI、DIY、知识库、塔罗、星台问卦和既有视觉成果的前提下，建成面向中国大陆与台湾地区、以无野设计为首个合作品牌的真实精选展示网站。首期展示经授权的成品、独家系列、设计师及清晰的创作入口；支付、统一商业订单、白牌、小程序、生产 3D 和部署不在本计划内。

**Architecture / 架构：** 单一玄矶经营主体；独立的成品目录，不复用 DIY 散珠 SKU 或设计订单冒充商城。先冻结公开 DTO、发布和授权规则，再新增 Prisma 表与只读仓储，再提供只返回合格已发布内容的 Fastify API，最后由 Next.js 展示。已有 DesignV1、DesignRevision、材料、价格和订单快照权威均不变。DeepSeek V4.1 Flash 负责 Contract/Database/Backend；Qwen 3.8 Flash 负责对标、前端页面和交互；SOL 只登记、审查、派发和验收，不修改生产实现。

**Tech Stack / 技术栈：** TypeScript、Zod、Prisma/PostgreSQL、Fastify、Next.js 16、React 19、现有 i18n 和 CSS、Node tests、Playwright/项目浏览器 QA。

**Spec / 规格：** [已批准的中文设计规格](../specs/2026-10-10-curated-showroom-site-design.md)。既有未完成 UX 仍由[星台两模型执行计划](2026-10-03-star-execution-dispatch.md)和其五份详细计划控制；[DIY 60 颗上限计划](2026-10-10-diy-60-bead-cap-implementation.md)独立控制自身路径。

## Global Constraints / 全局约束

- 每个**实际开工**任务由 SOL 先在 `docs/tasks/TASK_REGISTRY.md` 登记唯一 ID、唯一 owner、`task/<task-id>-<slug>` 分支、独立工作树、逐文件可写路径、禁止路径与验收门槛，再标为 `IN_PROGRESS`。下表 ID 是待派发候选，不预占锁；执行者不得自改注册表或跨路径修复。
- 先核对最新 `main`、活跃任务和候选提交。基线 `main@e634e6b` 仍将 `TASK-UX-BRACELET-FE-001` 记为 `IN_PROGRESS`；不得据聊天中的“已完成”绕过独立验收。星台首页/导航、工作台和共享 `star-content.css` 的在途任务必须先完成/解锁，再让商业任务写同一文件。
- 每项功能或页面族开工前提交一张中文对标卡：玄矶当前代码与同视口截图、一个真实竞品/优秀独立站的观察日期及具体排版/交互、一个适用开源项目的许可证/维护/兼容性（无则说明）、采用/改造/拒绝理由、对应测试与移动端截图。页面参考从规格 §4 起步；不复制图、文案、商标或授权不明代码。视觉优劣须有截图证据，不能只引用宣传语。
- 全站维持克制、干净、真实珠宝摄影与可读对比。不得覆盖已批准的 DIY 桌面三栏、手机上托盘/下材料面板、空托盘首珠、手串几何/透明线、Oracle/塔罗真实性或三语现有状态。首页让精选作品与创作并列，塔罗和星台各有入口。
- 公开内容必须逐件关联获确认的作品/媒体授权、地区、期限、版本、署名与修改范围；缺少真实图片、审校翻译或人工确认区域价格时不发布。无真实供货证据不写“现货”；无支付渠道不出现购物车、支付或订单成功 CTA。
- 每项 TDD：先写能为本任务行为失败的测试并保留 RED 原因，再最小实现、跑 GREEN；不得削弱旧断言、改成 skip 或伪造浏览器 PASS。移交前运行本任务窄测、类型检查/构建（相关模块）、`node --test tests/architecture.test.mjs`、`CI=1 pnpm validate` 和 `git diff --check`，如已有无关失败须在干净基线复现并如实报告，不得报绿。Conventional Commit；不推送、不部署、不自动合并。

## 固定的一期接口与展示决策

1. 新公开路径用无语言前缀的稳定 slug：`/shop`、`/shop/products/[slug]`、`/designers/[slug]`、`/collections/[slug]`。显示语言继续由仓库现有 `mystcrag_locale` cookie/`LocaleProvider` 掌管；服务端首屏与元数据使用同一已校验语言，切语言不换价格、地区或设计。规范链接指向当前稳定路径；**一期不声称三个语言版本都可分别被搜索引擎索引**，也不添加未经验证的 `hreflang`。语言可寻址 SEO 是后续独立任务，不为它改 Authing `proxy.ts`。
2. 公开市场仅 `CN`/`TW`，通过展示页显式 `?market=CN|TW` 选择并贯穿内部链接，默认 `CN`。市场决定可见 Listing/人工确认的 `CNY` 或 `TWD` 报价，不受语言菜单驱动；非法值返回安全错误或重定向到明确默认值，不能自动汇率换算。每个 URL 的 canonical 保留市场参数，防止台湾独有条目被指向大陆 404。动态公开数据使用 `no-store` 直至发布/撤回缓存失效策略另行获批。
3. API 前缀 `GET /api/showroom`，六个只读资源：`/products`、`/products/:slug`、`/collections`、`/collections/:slug`、`/designers`、`/designers/:slug`；查询含必填 `market`、`locale`，列表可带合同规定的 filter/sort/cursor。未发布、过期授权、地区不符、缺失批准媒体/翻译/价格的详情统一 404；列表不泄露这些记录的存在、内部成本或私有设计。异常不转成假商品。
4. 首期产品详情只展示真实作品、署名、材料/尺寸、区域与明确币种价格、如实的咨询/暂未开放状态和允许修改范围。通用“去 DIY 自由创作”仍是空托盘，不复制原款、不声称已经建立衍生关系。真正以某原款生成有来源记录的定制设计，需后续独立 Contract→DB→Backend→Frontend 任务并再次核对授权；当前不得把 `DesignTemplate` 或 query 参数当作此关系。
5. 展示页由 Next 服务端组件使用**仅服务端** `MYSTCRAG_BACKEND_ORIGIN`（沿用现有已校验配置）直接读取公开 Fastify GET，不经现有必须持有会话的 `/api/[...path]` BFF，也不把 token/cookie 转发给公开目录。筛选与市场切换更新 URL 触发服务端重取；语言菜单先更新现有显示 cookie，再仅对展示页 `router.refresh()`，不得发创建/保存 POST。公开页面无须登录；不修改 Authing `proxy.ts` 或放宽设计/订单 BFF 权限。

## 依赖、并行边界与任务登记候选

| 波次 | 候选 ID / 单 owner | 前置与交付 | 计划可写文件（登记时逐一复核） |
| --- | --- | --- | --- |
| A，可与 B 并行 | `TASK-COMMERCE-BENCH-001` / Qwen | 只读竞品/开源核验、页面族线框与桌面/手机视觉方向；产品所有者确认排版后解锁前端实现 | 新 `docs/superpowers/benchmarks/2026-10-10-curated-showroom.md`；独立 `output/playwright/task-commerce-bench-001/` 证据 |
| B | `TASK-COMMERCE-CONTRACT-001` / DeepSeek | 公开 DTO、市场/语言、授权与发布谓词，先于所有消费者 | 新 `packages/design-contract/src/schemas/showroom.schema.ts`、`packages/design-contract/tests/showroom-contract.test.ts`，`packages/design-contract/src/index.ts`，`docs/API_SPECIFICATION.md`，`docs/governance/CANONICAL_COMPONENTS.md` |
| C | `TASK-COMMERCE-DB-001` / DeepSeek | B 合入；新目录表、迁移、只读仓储，不改既有订单/材料/设计 | `packages/database/prisma/schema.prisma`、新 `packages/database/prisma/migrations/20261010120000_curated_showroom/migration.sql`、`packages/database/src/repositories/showroom.repository.ts`、`showroom.repository.unit.test.ts`、`showroom.repository.integration.test.ts`、`packages/database/src/index.ts`、`docs/DATABASE_SCHEMA.md` |
| D | `TASK-COMMERCE-BE-001` / DeepSeek | B+C 合入；Fastify 公开只读 API、发布安全规则 | 新 `apps/backend/src/modules/showroom/showroom.routes.ts`、`showroom.service.ts`、`showroom.routes.test.ts`、`showroom.service.test.ts`，`apps/backend/src/app.ts`、`apps/backend/src/index.ts`，`docs/API_SPECIFICATION.md`，`docs/governance/FEATURE_REGISTRY.md` |
| E1，素材依赖 | `TASK-COMMERCE-MEDIA-001` / Qwen（ASSET） | 产品所有者交付真实无野图片与逐图授权来源；只登记/核收可用素材 | `apps/frontend/public/showroom/wuye/` 下逐个批准文件和 `manifest.json`、新 `apps/frontend/src/features/showroom/showroom-assets.test.tsx`、指定证据目录；缺素材则 BLOCKED |
| E2，内容依赖 | `TASK-COMMERCE-CONTENT-001` / DeepSeek | D+E1 合入且产品所有者交付核准清单/三语文案/双区域价目；安全、幂等的导入与撤回演练 | 新 `packages/database/prisma/showroom-content-import.ts`、`showroom-content-import.test.ts`、经核准的 `packages/database/prisma/curated-content/wuye-v1.json`、`docs/DATABASE_SCHEMA.md` 导入段；**未拿到清单则保持 BLOCKED，不做假种子** |
| F | `TASK-COMMERCE-FE-CATALOG-001` / Qwen | A 获视觉确认、B+D 合入；服务端商品客户端、目录与详情，可在 E 前用测试 fixture 和真实空态开发 | 新 `apps/frontend/src/lib/api/showroom-api.ts`、`showroom-api.test.tsx`、`apps/frontend/src/features/showroom/components/showroom-catalog.tsx`、`showroom-catalog.test.tsx`、`showroom-product-detail.tsx`、`showroom-product-detail.test.tsx`、`showroom-locale-refresh.tsx`、`showroom-locale-refresh.test.tsx`、新 `apps/frontend/app/shop/page.tsx`、`app/shop/products/[slug]/page.tsx`、新 `apps/frontend/app/styles/showroom.css` |
| G | `TASK-COMMERCE-FE-STORY-001` / Qwen | F 合入；设计师与系列，复用 F 的 API 客户端/样式，不并发改共享文件 | 新 `apps/frontend/app/designers/[slug]/page.tsx`、`app/collections/[slug]/page.tsx`、`apps/frontend/src/features/showroom/components/showroom-designer.tsx`、`showroom-designer.test.tsx`、`showroom-collection.tsx`、`showroom-collection.test.tsx`，`apps/frontend/app/styles/showroom.css`、`src/lib/api/showroom-api.ts`（仅新增对应方法） |
| H | `TASK-COMMERCE-FE-SHELL-001` / Qwen | G 合入；星台首页/页眉相关任务已验收并解锁；首页、主导航/手机导航、三语与 SEO 集成 | `apps/frontend/app/page.tsx`、`app/navigation.ts`、`app/layout.tsx`、`components/mobile-bottom-nav.tsx`、`src/i18n/messages/zh-CN.ts`、`zh-TW.ts`、`en-US.ts`、`app/styles/star-content.css`（仅必要入口）、`src/features/navigation/navigation-capabilities.test.tsx`、`src/features/design/star-shell-contract.test.tsx`、新 `src/features/showroom/showroom-shell.test.tsx` |
| I | `TASK-COMMERCE-QA-001` / DeepSeek（QA） | E1/E2/F～H 与星台剩余目标均验收；独立浏览器/授权/市场/三语/回归闸门 | 新 `scripts/ui-qa/capture_curated_showroom.py`、`test_capture_curated_showroom.py`，`docs/INTERACTION_TEST_PLAN.md` 精选站段、`docs/governance/FEATURE_REGISTRY.md` 的最终生产入口核对、`output/playwright/task-commerce-qa-001/` 证据 |

**拟定分支：** A `task/commerce-bench-001-layout-reference`；B `task/commerce-contract-001-public-dto`；C `task/commerce-db-001-showroom-schema`；D `task/commerce-be-001-public-read`；E1 `task/commerce-media-001-wuye-assets`；E2 `task/commerce-content-001-approved-import`；F `task/commerce-fe-catalog-001-products`；G `task/commerce-fe-story-001-designers-collections`；H `task/commerce-fe-shell-001-navigation-home`；I `task/commerce-qa-001-showroom-gate`。它们仅为计划值；派发前 SOL 核对是否重名，再以注册表所填分支为唯一权威。每个执行任务的禁止路径默认为该行以外所有业务/测试/文档文件、其他任务锁、生成产物、用户改动及推送/部署/自动合并；确需新增依赖或文件时先停下修改注册表和审核范围。

每项只允许一个登记 owner；B→C→D 的 `docs/API_SPECIFICATION.md` 串行交接，F→G 的 showroom CSS/客户端串行，H 在星台首页与共享导航/CSS 完成之后才领取。A 与 B 可并行，因为没有重叠可写文件，但 Qwen 当前如仍持有 `TASK-UX-BRACELET-FE-001`，A 必须等该任务验收/释放后才领取；不以并行名义给同一个执行模型同时派发两项在途工作。E1/E2 缺真实批准数据不会阻断 F/G 的代码开发，但会阻断“无野商品已上线”与最终 I 的完整 PASS。每一波合入前由 SOL 独立复核 diff、许可、红绿证据和最小路径；发现失败直接退回原 owner 的精确复修单，不由 SOL 改运行时代码。

**星台遗留任务与本计划的交汇：** 先按登记表复核并接收在途的 `TASK-UX-BRACELET-FE-001`，再依[手串工作台计划](2026-10-03-star-bracelet-workbench.md)继续 002/003；[问卦结果计划](2026-10-03-star-oracle-result-experience.md)的前端/QA、[页面视觉计划](2026-10-03-star-page-family-visual-qa.md)的未登记页面族与最终浏览器矩阵，仍各自按原计划派发。只有这些任务的真实状态、代码与测试均验收，才能打开 H/I 的共享文件与总体验收。[60 颗上限计划](2026-10-10-diy-60-bead-cap-implementation.md)同理独立执行并进入 I 的回归门；本计划不把未合入候选误记为已完成，也不复制其实现任务。

## Review Focus / 复核重点

1. 产品/Listing/授权/媒体同时合格才公开；撤回、过期、缺市场、缺任一必需翻译或人工确认价格即时变为不可见，详情与列表一致。
2. 中文简/繁/英文只是展示层；`zh-TW + CN` 仍显示经批准的大陆 Listing 与 CNY，不出现自动 TWD 换算，`zh-CN + TW` 同理。404、空结果和接口失败有不同状态。
3. 材料 SKU、设计修订、授权衍生、订单快照和现有 API 无回写/旁路；未支付前没有可购买假象。
4. 320×568、390×844、768×1024、1440×900、1440×560、200% 缩放：导航、商品图、长文案/价格、目录筛选、语言/地区选择、真实动作没有溢出；44 px 触控、AA 对比、键盘顺序、减少动效符合规格。
5. 首页第一眼能分别发现“精选作品”与“自己创作”，塔罗和星台并存；DIY 桌面/手机旧布局及空托盘/历史/权限、Oracle 一键问卦和三语切换回归不破。

---

## Task A：真实对标与视觉决策（Qwen，可与 Task B 并行）

**Files：** 表 A 的 benchmark 文档和证据目录。**Produces：** 经产品所有者确认的三种页面模式、桌面/手机信息顺序、色彩/留白/组件限制，供 F～H 使用。

- [ ] **Step 1 — 捕获基线：** 首页/目录、详情、设计师/系列各记录当前玄矶路径、1440×900 与 390×844 截图；不存在的新页标明“当前缺失”，不能伪造基线。
- [ ] **Step 2 — 核对参考：** 每族记录至少一个实际打开的竞品 URL、观察日期、图片区占比/文字密度/导航顺序；对至少一个 OSS 候选写许可证、维护状态和现有 Next/React 兼容性。无法核实则注明，不能按“已验证更优”处理。
- [ ] **Step 3 — 输出线框：** 在指定文档与证据目录提交 320、390、1440 宽的三族线框/静态效果图；逐条写采用/改造/拒绝原因、AA/44 px/减少动效规则，不含假商品、竞品图文或脏纹理。
- [ ] **Step 4 — 验证与确认：** `node --test tests/architecture.test.mjs`、相对文档链接检查、`CI=1 pnpm validate`、`git diff --check`；SOL 审图并请产品所有者确认。未确认则 A 不算 DONE，F～H 不开工。
- [ ] **Step 5 — 提交：** 仅按 A 登记路径提交 `docs: benchmark curated showroom layouts`，报告截图与参考证据路径。

## Task B：公开目录 Contract（DeepSeek）

**Files：** 表 B 的五个精确文件。**Interfaces：** 定义 `ShowroomMarket = "CN" | "TW"`、`ShowroomLocale = "zh-CN" | "zh-TW" | "en-US"`、`ShowroomQuery`（`market`、`locale`、可选 filter/sort/cursor）、`ShowroomPublicProduct`、`ShowroomPage<T>`；导出 `parseShowroomQuery(input: unknown): ShowroomQuery` 与 `isPubliclyVisible(record: ShowroomPublicCandidate, at: Date, market: ShowroomMarket, locale: ShowroomLocale): boolean`。C/D/F 只消费这些类型/规则，不另造同名 DTO。

- [ ] **Step 1 — RED 测试：** 在 `packages/design-contract/tests/showroom-contract.test.ts` 固定 `2026-10-10T00:00:00Z`，断言缺任一简/繁/英审校文本、TW 非 TWD 报价、无批准媒体、撤回/到期 grant、非法 market/locale、负数或小数价格失败；公开输出无成本/私有设计/法律全文。
- [ ] **Step 2 — 确认失败：** `pnpm --filter @mystcrag/design-contract exec tsx --test tests/showroom-contract.test.ts` 必须因缺新 schema/行为而红，记录实际失败，不接受测试笔误红。
- [ ] **Step 3 — 最小实现：** 在 `showroom.schema.ts` 与 `index.ts` 实现上述接口、品牌/设计师/系列/原款/规格/Listing/Grant/媒体 DTO、`CN→CNY`/`TW→TWD`、授予起止时刻与可修改部位枚举；在 `docs/API_SPECIFICATION.md` 冻结六 GET 的 query、分页与 400/404/error envelope，在 `CANONICAL_COMPONENTS.md` 登记唯一权威。不修改 DesignV1/材料/订单 DTO。
- [ ] **Step 4 — GREEN：** 同一目标测试 PASS，`pnpm --filter @mystcrag/design-contract typecheck`、架构、validate 与 diff check 如实记录。
- [ ] **Step 5 — 提交：** 仅 B 文件，`feat(contract): define curated showroom public DTOs`；SOL 审查后解锁 C。

## Task C：Prisma 与只读目录仓储（DeepSeek）

**Files：** 表 C 的 schema、命名迁移、仓储及两份测试、index、数据库文档。**Interfaces：** `ShowroomRepository.listPublishedProducts(query: ShowroomQuery, now: Date): Promise<ShowroomPage<ShowroomPublicProduct>>` 与 `getPublishedProductBySlug(slug: string, query: ShowroomQuery, now: Date): Promise<ShowroomPublicProduct | null>`；集合/设计师提供同形的 `listPublished...`、`getPublished...BySlug`。这些方法是 D 的唯一目录读取入口。

- [ ] **Step 1 — RED 测试：** unit/integration tests 断言品牌—设计师多对多、唯一 slug/SKU/市场 Listing、草稿/撤回/授权过期/缺媒体/缺翻译/缺价格排除、`CN`/`TW` 隔离、稳定 cursor；旧 Design/Order/Material 行迁移前后不变。
- [ ] **Step 2 — 确认失败：** `pnpm --filter @mystcrag/database test` 和以隔离 `TEST_DATABASE_URL` 运行 `pnpm db:test`，记录新仓储/表不存在造成的 RED；不对用户库运行 reset。
- [ ] **Step 3 — 最小实现：** 在表 C 精确文件新建 `ShowroomBrand/Designer/BrandDesigner/Collection/Product/Variant/Listing/LicenseGrant/Media` 及三语审校内容；FK/唯一约束、发布/撤回时间与授权版本明确。仓储读取同一次请求中按 B 的谓词过滤，不修改旧快照或把材料 SKU 迁入成品表；更新 `docs/DATABASE_SCHEMA.md`。
- [ ] **Step 4 — GREEN：** 隔离库迁移/仓储测试、`pnpm --filter @mystcrag/database exec prisma validate`、数据库 typecheck、架构、validate、diff check；报告迁移与旧表保留证据。
- [ ] **Step 5 — 提交：** 仅 C 文件，`feat(database): add curated showroom read model`；SOL 审查后解锁 D。

## Task D：Fastify 公开只读 API（DeepSeek）

**Files：** 表 D 的四个 showroom 文件、`app.ts`、`index.ts` 与两个控制文档。**Interfaces：** `registerShowroomRoutes(app: FastifyInstance, service: ShowroomApiService): void`；`ShowroomApiService` 按 B/C 的 `list/get Products/Collections/Designers` 方法返回公开 DTO 或 `null`。`createApp({ showroomService })` 只开放这六个 GET，不改变受保护路由的认证前提。

- [ ] **Step 1 — RED 测试：** 六 GET 的有效 market/locale、非法 query 400、草稿/撤回/过期/缺图/缺价格的列表排除与详情 404、下一次请求立即反映撤回、数据库异常不泄成本/内部字段；未登录可读，旧设计/订单仍要认证。
- [ ] **Step 2 — 确认失败：** `pnpm --filter @mystcrag/backend exec tsx --test src/modules/showroom/showroom.routes.test.ts src/modules/showroom/showroom.service.test.ts` 应因路由未注册或服务不存在而红。
- [ ] **Step 3 — 最小实现：** 依 B/C 类型实现公开只读服务和路由，接入 `app.ts`/真实 `index.ts`，响应 `no-store`；不得以“前端不显示”代替服务端过滤，不新增管理写入 API。更新 API 规格与 `FEATURE_REGISTRY.md`。
- [ ] **Step 4 — GREEN：** 新测试、`pnpm --filter @mystcrag/backend test`、backend typecheck/build、既有订单/私有设计相邻回归、架构、validate、diff check；至少一次 Fastify inject 证明无登录目录可读。
- [ ] **Step 5 — 提交：** 仅 D 文件，`feat(backend): expose public curated showroom reads`；SOL 审查后解锁 F。

## Task E1：无野真实作品图核收（Qwen/ASSET；缺授权素材则 BLOCKED）

**Files：** 表 E1 的受控图片目录、`manifest.json` 与 `showroom-assets.test.tsx`；登记时必须逐张列出实际文件名。**Interface：** `manifest.json` 为 `{ assetKey, path, sha256, width, height, licenseRef }[]`；E2 的离线导入只读此批准清单验证 key/文件存在与 SHA，F/G 的运行时图片 URL 则只来自 Backend 公开 DTO，不从前端另造商品媒体权威。

- [ ] **Step 1 — RED 测试：** 断言清单引用未知文件、缺来源/许可/尺寸、SHA 与真实文件不一致、一个 key 指向另一作品均失败；逐张核对许可展示区域与期限。没有原件/许可即不启动本任务，状态 BLOCKED。
- [ ] **Step 2 — 确认失败：** `pnpm --filter @mystcrag/frontend exec tsx --test src/features/showroom/showroom-assets.test.tsx` 先因批准清单缺失而红，记录失败。
- [ ] **Step 3 — 最小实现：** 只添加批准图片与 `manifest.json`；保存来源、SHA、尺寸、许可引用 ID，三语 alt 由 E2 的审校内容提供。不得将法律全文、竞品图或 AI 猜测的无野商品入库。
- [ ] **Step 4 — GREEN：** 新测试、逐图可读/裁切与产品所有者核收、前端 typecheck/build、架构、validate、diff check；记录批准/拒绝图片数。
- [ ] **Step 5 — 提交：** 仅 E1 登记文件，`feat(assets): add approved Wuye showroom photography`；未批准保持 BLOCKED，不做空提交冒充完成。

## Task E2：真实无野内容的受控导入（DeepSeek；缺数据则 BLOCKED）

**Files：** 表 E2 的受控 JSON 清单、导入脚本/测试与数据库文档。**Interface：** `importApprovedShowroomManifest(db, manifest, { dryRun: boolean; approvedBy: string }): Promise<{ created: number; updated: number; withdrawn: number }>`；未显式确认时只执行 dry-run。输入由 B 的 DTO 校验；离线校验图片 key 与 E1 已批准 `manifest.json` 中的文件/SHA 一致，不引入数据库包对前端 TS 源码的运行时 import。

- [ ] **Step 1 — 输入门：** SOL 收齐逐件名称、设计师/系列、E1 批准图 key、展示/修改授权版本/期限、CN/TW 范围、人工确认价格、材料/尺寸/养护、三语审校 title/summary/alt、咨询状态及批准者；缺一项则 E2 保持 BLOCKED。清单仅记录公开元数据和授权引用 ID，不放法律全文。
- [ ] **Step 2 — RED 测试：** `showroom-content-import.test.ts` 断言少授权/图/语言/地区价即整体拒绝，同版本重放计数为 0、撤回后六 GET 不再返回、旧授权版本仍可审计。运行 `pnpm --filter @mystcrag/database exec tsx --test prisma/showroom-content-import.test.ts`，记录行为红因。
- [ ] **Step 3 — 最小实现：** 导入脚本显式数据库目标、默认 dry-run、真实批准者、事务式全有或全无、版本幂等与撤回；绝不自动连生产库、自动换汇或造库存。更新 `docs/DATABASE_SCHEMA.md` 的导入/撤回段。
- [ ] **Step 4 — GREEN：** 隔离数据库导入/重放/撤回测试、六 GET 抽样、数据库 typecheck、架构、validate、diff check；记录清单 SHA 和真实发布/拒绝数。
- [ ] **Step 5 — 提交：** 仅 E2 登记文件，`feat(database): import approved Wuye showroom content`；缺清单时 F/G 只用测试 fixture 与真实空态，不能把临时商品公开。

## Task F：精选目录与商品详情（Qwen）

**Files：** 表 F 的服务端 API 适配器、四个组件/测试、两条新路由与 `showroom.css`。**Interfaces：** `getShowroomProducts(query: ShowroomQuery): Promise<ShowroomPage<ShowroomPublicProduct>>`、`getShowroomProduct(slug: string, query: ShowroomQuery): Promise<ShowroomPublicProduct | null>`，均 server-only、`cache: "no-store"`、不转发 cookie/token；`ShowroomLocaleRefresh` 监听现有显示语言变更并只调用 `router.refresh()`，不发业务 POST。

- [ ] **Step 1 — RED 测试：** `showroom-api.test.tsx` 断言请求只去 Backend 公开 GET、URL 编码/market/locale 正确、无 Authorization/Cookie；目录/详情测试断言 404/空/网络错误各自不同、TW/CN 币种不随语言变、无购物车/支付 CTA、媒体 alt 与价格仅来自公开 DTO；locale-refresh 测试断言语言切换无创建/保存 POST。
- [ ] **Step 2 — 确认失败：** `pnpm --filter @mystcrag/frontend exec tsx --test src/lib/api/showroom-api.test.tsx src/features/showroom/components/showroom-catalog.test.tsx src/features/showroom/components/showroom-product-detail.test.tsx src/features/showroom/components/showroom-locale-refresh.test.tsx` 必须为缺行为而红。
- [ ] **Step 3 — 最小实现：** server component/adapter 完成 `/shop` 筛选排序、`/shop/products/[slug]` 图集/材料/规格/价格/状态；市场 query 贯穿链接；语言刷新只重取展示 GET。DIY 只写“从空托盘自行创作”，不预放珠/创建订单。参考 A 的视觉方向，不在无真实内容时用假商品撑版。
- [ ] **Step 4 — GREEN：** 上述测试、前端 typecheck/lint/build、架构、validate、diff check；六视口/200%/三语/两市场截图，AA、44 px、键盘、减少动效检查；不纳入 `next-env.d.ts` 漂移。
- [ ] **Step 5 — 提交：** 仅 F 文件，`feat(frontend): add curated catalog and product pages`；SOL 独立审查后解锁 G。

## Task G：设计师与合作系列（Qwen）

**Files：** 表 G 的两条路由、两组 story 组件/测试、F 的客户端和 CSS。**Interfaces：** 扩展 F 的服务端适配器 `getShowroomDesigner(slug, query)` 与 `getShowroomCollection(slug, query)`，返回 B 的公开 DTO 或 `null`；不新增第二商品卡/价格解析权威。

- [ ] **Step 1 — RED 测试：** `showroom-designer.test.tsx`、`showroom-collection.test.tsx` 断言只列本市场已发布作品、作者署名/玄矶经营者分离、未经批准的人物/工艺叙述不出现、无作品时真实空态、长三语不裁切、可修改范围来自 grant。
- [ ] **Step 2 — 确认失败：** `pnpm --filter @mystcrag/frontend exec tsx --test src/features/showroom/components/showroom-designer.test.tsx src/features/showroom/components/showroom-collection.test.tsx` 应为新页面/行为缺失而红。
- [ ] **Step 3 — 最小实现：** 复用 F 的客户端、图卡和 token，完成 `/designers/[slug]`、`/collections/[slug]` 的故事—作品交替排版与经审校 metadata/canonical；不复制原款成消费者设计、不重复同尺寸卡片网格。
- [ ] **Step 4 — GREEN：** 目标测试、六视口/三语真实截图、AA/键盘/减少动效、typecheck/lint/build/架构/validate/diff check；共享文件仅在 F 验收后改。
- [ ] **Step 5 — 提交：** 仅 G 文件，`feat(frontend): add designer and collection stories`；SOL 审查后解锁 H。

## Task H：首页、导航和三语入口整合（Qwen，需先解锁星台共享文件）

**Files：** 表 H 的首页、导航、页眉布局、三语词典、必要 CSS 与精确 tests。**Interfaces：** `getMainNavigation({ tarotEnabled, oracleEnabled })` 保持原签名；新增商城入口使用 `href="/shop?market=CN"`，市场切换在展示页传递 query，不篡改 cookie；三语新 message keys 在三份字典逐一对应。

- [ ] **Step 1 — 前置/RED：** SOL 核对星台共享文件已解锁，A 效果图已获产品所有者确认；否则 H 保持 READY。在 `navigation-capabilities.test.tsx`、`star-shell-contract.test.tsx`、`showroom-shell.test.tsx` 写 RED，覆盖 Tarot/Oracle 四种开关组合、精选/创作双入口、语言不改市场或报价、未发布产品不进首页、320 宽/低高桌面不裁切。
- [ ] **Step 2 — 确认失败：** `pnpm --filter @mystcrag/frontend exec tsx --test src/features/navigation/navigation-capabilities.test.tsx src/features/design/star-shell-contract.test.tsx src/features/showroom/showroom-shell.test.tsx` 因缺新商城入口或布局而红。
- [ ] **Step 3 — 最小实现：** 调整首页、导航、手机导航、必要页眉/CSS 与三份消息字典；首页作品模块只读 D 的公开商品，空目录呈现诚实文案。首屏以精选作品/自己创作为双路，不挤掉塔罗、星台、AI、DIY、知识库/画廊；避免假商品、装饰性空白条和大面积脏纹理。
- [ ] **Step 4 — GREEN：** 新旧首页/导航/i18n 测试、320/390/768/1440/1440×560/200% 截图、AA/44 px/键盘/减少动效、typecheck/lint/build/架构/validate/diff check；确认旧创作入口与状态仍可用。
- [ ] **Step 5 — 提交：** 仅 H 文件，`feat(frontend): connect curated showroom to site shell`；SOL 独立审查后解锁 I。

## Task I：独立整站验收（DeepSeek QA，SOL 终审）

**Files：** 表 I 的 QA 脚本/test、交互计划段、生产入口核对与独立证据目录。**Interface：** `capture_curated_showroom.py --validate` 输出每个 case 的 `PASS | FAIL | BLOCKED`、截图路径和控制台错误；不复写既有星台 73 项记录。

- [ ] **Step 1 — RED 探针：** `test_capture_curated_showroom.py` 注入一个隐藏商品、TW 显示 CNY、缺授权图和 320 px 溢出，断言验证器分别报 FAIL；无浏览器/第二用户/批准内容时明确 BLOCKED，不能报 PASS。
- [ ] **Step 2 — 确认失败：** `python3 -m unittest discover -s scripts/ui-qa -p 'test_capture_curated_showroom.py'` 先因新探针不存在而红，记录原因。
- [ ] **Step 3 — 最小实现：** 对 CN/TW × 三语 × 发布/撤回/缺翻译/缺价格 × 六视口/200% × 未登录/登录采证；查产品/作者/系列/首页、API 数据溯源、图片/授权、404/空/失败、键盘/AA；并原样保留 Star 73 项及 AI、DIY 空托盘/历史/手串、Oracle、Tarot、画廊、个人中心回归。记录真实 PASS/FAIL/BLOCKED 与 console。
- [ ] **Step 4 — GREEN：** QA 自测与真实浏览器矩阵、前端完整带引号 glob、backend/database 目标测试、架构、构建、`CI=1 pnpm validate`、`git diff --check`；任何非绿或缺环境/数据都如实记录，重要失败交原 owner 限范围复修。
- [ ] **Step 5 — 提交与终审：** 仅 I 文件 `test(qa): gate curated showroom journeys`。SOL 独立审所有任务 diff/许可/截图，产品所有者确认整站；仅 E1/E2 真实内容入库且 QA 全绿时宣布展示目标完成。不推送、部署或启用支付。

## 明确留到下一规格的事项

- 成品/定制统一订单、库存预留、支付、退款、履约、物流及大陆/台湾支付服务商申请。既有设计订单不可直接伪装为商城订单。
- 从设计师原款创建带授权版本和可追溯来源的消费者衍生设计及材料包，需 Contract→DB→Backend→Frontend 专项规格；当前 DIY 仍是独立空托盘创作。
- 语言可寻址多语 SEO、区域配送/税务政策、白牌、小程序、生产 3D 和正式部署。
