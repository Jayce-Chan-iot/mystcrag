# @mystcrag/commerce — 隔离 Medusa 基座（Phase 1 Task 1）

`TASK-COMMERCE-MEDUSA-BASE-001` 的交付：官方 `create-medusa-app@2.21.2` scaffold 后端子树（适配 pnpm workspace），固定 Medusa `2.21.2`。本阶段只接入**隔离**内核：尚未接入购买流程/真实支付，也不接真实无野商品、公开商城路由或前端页面。

官方 scaffold 文件清单与注册路径不同的说明：scaffold 生成的 `jest.config.js`、`integration-tests/`（Jest 集成测试工具链）与 starter 演示数据脚本（`src/scripts/seed-demo-products.ts`、`src/migration-scripts/initial-data-seed.ts`）未移植；隔离测试改由本包 `tests/isolation.test.ts`（node:test + tsx）承担，演示商品/服装 seed 与「不接真实无野商品、不写虚构 seed」的边界冲突。其余 scaffold 文件（`instrumentation.ts`、`src/**` 样例扩展、`eslint.config.ts`、`tsconfig.json`）按原样保留；devDependencies 保留 CLI 运行必需项（`ts-node` 加载 `medusa-config.ts`、`@swc/core` 配合 `ts-node.swc`、`vite` 供 Admin 构建）；scaffold 的 `@types/react`/`@types/react-dom` devDependencies 有意未移植——本包无 React 源码，且它们会让 pnpm 11 的 workspace hoist 把 `@types/react` 从 19 翻转为 18、破坏 `@mystcrag/frontend` typecheck（依据见 `docs/DEPENDENCY_DECISIONS.md` 版本核查补记）。所有产物均在注册的可写路径 `apps/commerce/**` 内，未改任何根配置。

注意：Medusa 依赖引入 4 个带构建脚本的包（`@medusajs/telemetry`、`@swc/core`、`msgpackr-extract`、`protobufjs`）。pnpm 11 默认 `strictDepBuilds: true`，在根 `pnpm-workspace.yaml` 的 `allowBuilds` 补齐这 4 项之前，仓库级 `pnpm install`（含 CI `--frozen-lockfile`）会以 `ERR_PNPM_IGNORED_BUILDS` 退出 1。该项属根配置，已连同推荐取值上报待决（见 `docs/DEPENDENCY_DECISIONS.md` 版本核查补记）。

## 隔离契约

- 数据库只读 `COMMERCE_DATABASE_URL`；缺失、空白或与 `DATABASE_URL` 相同时**失败关闭**（`src/isolation/env.ts`），绝不回退到玄矶用户库。
- 隔离比较按数据库**实际目标**（按驱动语义解析的 host/port/database）进行：`postgres`/`postgresql` 别名、凭据差异、`localhost`/`127.0.0.1`/`::1` 回环别名、缺省端口、尾斜杠都不能绕过与 `DATABASE_URL` 的隔离检查；解码同样照驱动语义——数据库名按 `decodeURI`（`foo%253F` 与 `foo%3F` 实际同库，探针经驱动链真实连接以 `current_database()` 证实）、主机按 `decodeURIComponent`（`127%2E0%2E0%2E1` 实际是 127.0.0.1），非法百分号编码失败关闭；非 PostgreSQL 协议或非法 URL 一律失败关闭。数据库用户/角色也与用户库相互独立。
- `host`/`port` 查询参数**已实测**会在 URL 自身目标之上覆盖连接（pg-connection-string 以查询参数优先），两条 URL 上都被直接拒绝；`dbname`/`database` 属**保守拒绝**——实测当前安装的驱动构建最终仍以 URL 路径为准覆盖它们（不会重定向连接目标），守卫仍拒绝以不依赖某个驱动版本的行为；`sslmode`、`schema` 等不改变目标的参数不受影响。
- 本地 `.env` 若声明 `COMMERCE_DATABASE_URL` 会被 `medusa-config.ts` 直接拒绝：Medusa CLI 会先加载 `.env`，值来源不可辨别；该变量必须经进程环境变量（如 shell `export`）提供。识别按 dotenv 实际语法（`KEY=value` 与 `KEY: value`，可带 `export` 前缀）而非某一种写法。
- 开发启动入口 `medusa:dev` 固定 `--host 127.0.0.1`，默认只监听本机回环；隔离探针通过**同一入口**启动，并实测非回环接口无法访问 Store/Admin（不能仅靠 CORS）。
- CORS 默认只含 loopback 来源；本阶段不向玄矶公众域名暴露 Medusa 原生 Store/Admin 路径（无任何前端/后端代理路由，`tests/isolation.test.ts` 持续断言）。
- 翻译模块已按 PoC 实测写法开启（`modules: ['@medusajs/medusa/translation']` + `featureFlags.translation`），公开读取闸门属 Task 3。
- **尚未接入购买流程/真实支付**（无购物车/支付 provider 接入）、未接入现有 Prisma、未写任何 `apps/frontend`、`apps/backend`、`packages/**`。

## 公开橱窗发布闸门（Phase 1 Task 3）

`TASK-COMMERCE-GATE-001` 交付一个**失败关闭**的服务端发布闸门：四个匿名只读公共路由（`GET /api/showroom/products`、`/api/showroom/products/{slug}`、`/api/showroom/designers/{slug}`、`/api/showroom/collections/{slug}`）由**同一个纯谓词**（`src/showroom/publication-gate.ts`）决定列表与详情的可见性，绝不各自为政。

- 一个资源只有在下列事实**全部一致**时才可能被服务：实时 Medusa 事实（Product 已 `published`）、带版本的授权（`APPROVED`、覆盖请求市场、在有效窗口内）、该市场的**人工批准价指纹**、请求语言的**已审校文案**、至少一个**已批准且未撤回、带来源校验和**的媒体。任何一项缺失或缺译，列表即排除、详情返回 `404 NOT_FOUND`（与未知 slug 相同，不泄露存在性）；上游读取失败返回 `500 INTERNAL_ERROR`，绝不回退到原生 Store 响应、草稿或另一语言/另一市场的文案。
- **不换汇**：市场 `CN` 只发 `CNY`、`TW` 只发 `TWD`；市场与显示语言 `zh-CN`/`zh-TW`/`en-US` 严格分离，`zh-TW` 配 `CN` 仍为 `CNY`、`zh-CN` 配 `TW` 仍为 `TWD`。价格为**逐市场**批准：记录为每个市场保存一份指纹（`sha256(regionId|currency|amountMinor)`），只批准一个市场不会服务另一个市场。
- 实时价格经 **Query 层**读取：Medusa 的 Product 模块从不 hydrate `variants.prices`，变体金额与地区 `region_id` 规则由 Pricing 模块经 `query.graph` 借 `variants.price_set.prices` 提供；价格在 Admin 侧被改动而未重新批准时指纹不再匹配，产品失败关闭（`PRICE_CHANGED_SINCE_APPROVAL`）。译文同理：`APPROVE` 时服务端为每个已审校语言写入其**实时 Medusa 译文指纹**，公共读取每次从翻译模块重算该语言指纹并比对，Admin 在审批后改动译文而未重新审校时该语言立即失败关闭（`TRANSLATION_CHANGED_SINCE_REVIEW`，列表排除、详情 `404`）；无译文行按空载荷指纹比较，故之后新增译文本身即视为变更。
- Admin 审核路由 `GET|POST /admin/showroom-approvals/{productId}`（需 Medusa Admin 认证）记录**一次一条、带审计**的人工决策：`APPROVE`（版本化授权 + 逐市场批准价 + 逐语言审校文案 + 已批准媒体）、`REVOKE`（撤回整条授权）、`WITHDRAW_MEDIA`（按来源校验和撤回单个资产）。每个动作追加一条审计事件并在**下一次公共读取**生效；此面只做决策记录，从不写入商品、变体、价格行或媒体文件。公共 DTO 均由唯一的设计契约 Showroom schema 经**运行时 `safeParse`**产出，不存在仅类型校验的旁路。
- 同一 `subject_kind + subject_ref` **仅有一行**：由生成的唯一索引在持久层保证；每个决策在**同一数据库事务**内先对既有行取 `SELECT ... FOR UPDATE` 行锁，故两个独立写入者（进程/副本）在既有行上串行化，读取后不会用整行覆盖另一方的决策、也不丢其审计事件；并发首次审批中输掉插入竞争的一方转为更新获胜行。因此重复导入同一条 `APPROVE` 幂等（一行 + 追加一条审计），并发首次审批既不产生第二行也不丢审计事件。撤回是记录**事实**（墓碑）而非可清除字段：某校验和被撤回后跨**任意后续审批**始终为撤回——后续审批即便省略该资产、随后又重新引入，也不再恢复它。
- 审计事件携带足以**仅凭审计重建当时公开响应**的事实：所应用的 `publicRevision`、决策后的 `authorizationStatus`/`markets`、授权窗口 `effectiveFrom`/`expiresAt`、展示态 `availability`、逐市场批准价事实 `approvedPrices`（market/currency/amountMinor/regionId/fingerprint）、逐语言**完整已批准文案** `approvedCopy`（locale + 该语言的整份已审校文案，含 reviewedRevision/translationFingerprint/标题/摘要/材质/规格/设计师）、`APPROVE` 授权的完整媒体事实 `approvedMedia`（checksum + url + alt），以及 `WITHDRAW_MEDIA` 撤回的 `withdrawnMedia`（checksum + url + alt）。这些文案与媒体事实是**独立深拷贝快照**，不与记录中的活对象共享引用，故后续一次 `APPROVE` 覆盖了记录里的现行文案后，仍能仅凭先前那条审计事件重建那一刻的公开响应，无需再读实时 Medusa 行。
- Admin 决策面错误映射：请求形状违例为 `400 VALIDATION_ERROR`；对该 subject **无既有审批**、或撤回**该记录从未持有的校验和**为 `404 NOT_FOUND`；翻译模块或数据库故障为 `500 INTERNAL_ERROR`，且**不向响应泄露**内部错误细节。公共 `400/404/500` 一律使用仓库共享信封 `{ error: { code, message, fieldErrors?, requestId } }`（requestId 取 Medusa 请求 id，拒绝策略同样如此），不为该面放宽规范。
- 隔离集成测试 `tests/showroom-isolation.integration.test.ts` 仅在显式提供隔离库与 canary 用户库时运行：它把生成的 showroom 迁移应用到**全新隔离库**、经 `medusa:dev` 起两个独立写入服务、驱动真实公共/Admin HTTP 面，并断言迁移含唯一索引、撤回在**任意后续审批序列**下持续有效、未知校验和撤回返回 404、并发首次审批单行且审计不丢、Admin 改动译文后公开读取关闭、撤回/撤销在下次读取生效、审计事件含**完整已批准文案**，以及 canary 用户库零表/零写入。跨进程用例不用固定 sleep：先由一条独立连接对既有审批行取 `SELECT ... FOR UPDATE` 行锁，并用第二条连接的 `FOR UPDATE NOWAIT`（`55P03`）**确认锁确被持有**；随即在锁仍被持有时启动两个写入进程的真实写请求，断言两请求仍**在途**、并由数据库 `pg_locks` 观测到二者作为未授予的行锁等待者**阻塞在该锁上**；随后**显式提交并释放锁**，再等待两请求完成，并断言其**完成时刻不早于释放时刻**——以重叠与时序断言证明并发，而非计时。

## 环境变量（`.env.example`）

`COMMERCE_DATABASE_URL` 必填，且**不得写入 `.env`**（必须经进程环境变量提供）；`JWT_SECRET`、`COOKIE_SECRET` 必填；`STORE_CORS`/`ADMIN_CORS`/`AUTH_CORS` 缺省为 loopback。

## 本地命令

```bash
pnpm --filter @mystcrag/commerce typecheck     # tsc --noEmit
pnpm --filter @mystcrag/commerce test          # 隔离契约测试（node:test）
pnpm --filter @mystcrag/commerce medusa:migrate   # 需要 COMMERCE_DATABASE_URL
pnpm --filter @mystcrag/commerce medusa:dev       # develop，默认 :9000，只监听 127.0.0.1，Admin 在 /app
pnpm --filter @mystcrag/commerce probe:isolation  # 冷启动/重启隔离探针（需本机 PostgreSQL 工具链）
```

`probe:isolation` 在系统临时目录创建抛弃式 PostgreSQL 集群：一个集群超级用户 + 每个数据库一个独立登录角色（commerce 库与 canary 用户库互无 CONNECT 权限、归属各自角色），外加一个 decoy 数据库用于本地 `.env` 回归、一个名字是字面量 `foo%3F` 的库用于百分号编码回归。用虚构数据验证：缺失/共享（含别名、凭据差异、尾斜杠变体）/非法 URL 与本地 `.env` 声明（`=` 与 `:` 两种加载语法）的失败关闭（decoy 库零表）、覆盖连接目标的查询参数被拒（先用 Medusa 实际解析到的 pg 解析器证明该 URL 真会连到 canary，再断言守卫拒绝且 canary 零会话）、百分号编码拼写被拒（先用同一驱动链真实连接并读取 `current_database()` 证明 `foo%253F` 与 `foo%3F` 同为库 `foo%3F`，再断言守卫拒绝且该库零表）、经 `pnpm run medusa:dev` 冷启动且监听套接字只有 127.0.0.1（非回环接口对同一组 Store/Admin 路径实测 TCP 拒绝）、隔离库迁移归属 commerce 角色、重启持久化、商品/规格/系列与 CN/CNY、TW/TWD 人工 region 价格，并断言 canary 用户库零表/零会话。日志写入 `output/playwright/task-commerce-medusa-base-001/`（被 gitignore）。

## 回滚

移除 `apps/commerce/`、还原 `pnpm-lock.yaml` 与 `docs/DEPENDENCY_DECISIONS.md` 的本任务提交即可；不涉及既有 Prisma 数据、后端或前端路由（计划 Task 1–4 的回滚口径）。