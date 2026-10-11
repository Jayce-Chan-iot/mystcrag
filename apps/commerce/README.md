# @mystcrag/commerce — 隔离 Medusa 基座（Phase 1 Task 1）

`TASK-COMMERCE-MEDUSA-BASE-001` 的交付：官方 `create-medusa-app@2.21.2` scaffold 后端子树（适配 pnpm workspace），固定 Medusa `2.21.2`。本阶段只接入**隔离**内核，不接支付、购物车、真实无野商品、公开商城路由或前端页面。

官方 scaffold 文件清单与注册路径不同的说明：scaffold 生成的 `jest.config.js`、`integration-tests/`（Jest 集成测试工具链）与 starter 演示数据脚本（`src/scripts/seed-demo-products.ts`、`src/migration-scripts/initial-data-seed.ts`）未移植；隔离测试改由本包 `tests/isolation.test.ts`（node:test + tsx）承担，演示商品/服装 seed 与「不接真实无野商品、不写虚构 seed」的边界冲突。其余 scaffold 文件（`instrumentation.ts`、`src/**` 样例扩展、`eslint.config.ts`、`tsconfig.json`）按原样保留；devDependencies 保留 CLI 运行必需项（`ts-node` 加载 `medusa-config.ts`、`@swc/core` 配合 `ts-node.swc`、`vite` 供 Admin 构建）；scaffold 的 `@types/react`/`@types/react-dom` devDependencies 有意未移植——本包无 React 源码，且它们会让 pnpm 11 的 workspace hoist 把 `@types/react` 从 19 翻转为 18、破坏 `@mystcrag/frontend` typecheck（依据见 `docs/DEPENDENCY_DECISIONS.md` 版本核查补记）。所有产物均在注册的可写路径 `apps/commerce/**` 内，未改任何根配置。

注意：Medusa 依赖引入 4 个带构建脚本的包（`@medusajs/telemetry`、`@swc/core`、`msgpackr-extract`、`protobufjs`）。pnpm 11 默认 `strictDepBuilds: true`，在根 `pnpm-workspace.yaml` 的 `allowBuilds` 补齐这 4 项之前，仓库级 `pnpm install`（含 CI `--frozen-lockfile`）会以 `ERR_PNPM_IGNORED_BUILDS` 退出 1。该项属根配置，已连同推荐取值上报待决（见 `docs/DEPENDENCY_DECISIONS.md` 版本核查补记）。

## 隔离契约

- 数据库只读 `COMMERCE_DATABASE_URL`；缺失、空白或与 `DATABASE_URL` 相同时**失败关闭**（`src/isolation/env.ts`），绝不回退到玄矶用户库。
- CORS 默认只含 loopback 来源；本阶段不向玄矶公众域名暴露 Medusa 原生 Store/Admin 路径（无任何前端/后端代理路由，`tests/isolation.test.ts` 持续断言）。
- 翻译模块已按 PoC 实测写法开启（`modules: ['@medusajs/medusa/translation']` + `featureFlags.translation`），公开读取闸门属 Task 3。
- 未启用购物车/支付 provider、未接入现有 Prisma、未写任何 `apps/frontend`、`apps/backend`、`packages/**`。

## 环境变量（`.env.example`）

`COMMERCE_DATABASE_URL`、`JWT_SECRET`、`COOKIE_SECRET` 必填；`STORE_CORS`/`ADMIN_CORS`/`AUTH_CORS` 缺省为 loopback。

## 本地命令

```bash
pnpm --filter @mystcrag/commerce typecheck     # tsc --noEmit
pnpm --filter @mystcrag/commerce test          # 隔离契约测试（node:test）
pnpm --filter @mystcrag/commerce medusa:migrate   # 需要 COMMERCE_DATABASE_URL
pnpm --filter @mystcrag/commerce medusa:dev       # develop，默认 :9000，Admin 在 /app
pnpm --filter @mystcrag/commerce probe:isolation  # 冷启动/重启隔离探针（需本机 PostgreSQL 工具链）
```

`probe:isolation` 在系统临时目录创建抛弃式 PostgreSQL 集群与两个数据库（探测库 + canary 用户库），以虚构数据验证迁移、冷启动、重启持久化、商品/规格/系列与 CN/CNY、TW/TWD 人工 region 价格，并断言 canary 用户库零表/零会话。日志写入 `output/playwright/task-commerce-medusa-base-001/`（被 gitignore）。

## 回滚

移除 `apps/commerce/`、还原 `pnpm-lock.yaml` 与 `docs/DEPENDENCY_DECISIONS.md` 的本任务提交即可；不涉及既有 Prisma 数据、后端或前端路由（计划 Task 1–4 的回滚口径）。