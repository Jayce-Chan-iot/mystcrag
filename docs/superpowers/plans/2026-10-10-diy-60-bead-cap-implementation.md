# DIY 工作台 60 颗珠子上限 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DIY 新增珠子最多 60 颗；用户看到清楚的数量与处理办法，服务端拒绝绕过界面的第 61 颗，并保留历史设计的恢复路径。

**Architecture:** Design Contract 提供唯一公开常量，Backend 更新入口是新增权威，Database 订单事务是新订单的最终权威，Frontend 只做即时引导和错误恢复；不把上限写进通用 `DesignV1Schema` 或 Bracelet Engine。

**Tech Stack:** TypeScript、Zod、Fastify、Prisma/PostgreSQL、Next.js/React、`tsx --test`、Playwright 浏览器验收。

**Spec:** `docs/superpowers/specs/2026-10-10-diy-60-bead-cap-design.md`（2026-10-10 产品所有者已确认）。

## Global Constraints

- 本计划不授权直接实施。SOL 先为以下每个执行阶段在 `docs/tasks/TASK_REGISTRY.md` 建立唯一 ID、唯一 owner、`task/<task-id>-<slug>` 分支、精确可写路径和专属工作树，并在编辑前标为 `IN_PROGRESS`。执行者不得自行扩写路径或修改其他任务行；审核、合并与推送另行决定。
- 当前 `TASK-UX-BRACELET-FE-001` 仍在 `IN_PROGRESS`，其展示求解器 160 珠反例和 `.test.ts`/`.test.tsx` 登记不符独立待修。60 颗限制不替代该任务，不截断历史/非 DIY 的预览，也不得编辑其锁定的 `frontend-ai-flow.test.tsx`、`flat-bracelet-editor.tsx` 等文件。Qwen 的本任务前端阶段以现有锁释放且 Contract 已验收为前提。
- 只数 `DesignV1.beads.length`，`INLINE`/`ANCHORED` 配饰不计。对旧 `DIY_CREATED` 超限设计，允许读、保存、逐次减少、等量替换及重排；不准再新增，不准创建**新**订单。已有订单不可变且同修订订单重放仍须返回原结果。AI/Tarot/Oracle 自动生成和未进入 DIY 编辑的既有非 DIY 下单不因本规则失效；若实现发现无法区分这些路径，先向 SOL/产品所有者报告，不准悄悄扩大为全站生成上限。
- `POST /api/design/update` 同时服务 DIY 工作台与水晶库，因此任何手工 `ADD_COMPONENT` 珠子都必须受上限约束；两处前端入口都要消费同一常量。`60 → 60` 删除加回可行；旧 `70 → 69` 可行；旧超限时即使同批删除，只要含新增珠子也拒绝。请求失败不产生新修订、价格、库存预留或事件。
- 不新建第二个设计状态 store、renderer 或错误封套；不改 Prisma schema、`DesignV1` 结构、根脚本或生成文件。错误码固定为 `DIY_BEAD_LIMIT_EXCEEDED`，HTTP 400，三语显示；服务端文案不得泄露库存、成本、其他用户设计。
- 每个阶段走 RED→最小 GREEN→局部验证→`tests/architecture.test.mjs`→`CI=1 pnpm validate`→`git diff --check`。必须原样报告与本任务无关的失败或取消，不改弱门槛。允许记录外部托管工作树导致的既有 asset-worker 根路径断言，但不能把失败说成通过。每阶段 Conventional Commit、干净工作树、无推送/部署/自动合并。

## Review Focus

1. 60 与 61 的跨 API 持久化边界、旧数据恢复、并发 `expectedRevision`、订单重放与副作用零发生。
2. `REPLACE_COMPONENT` 从配饰变珠子、同批删加、仅配饰新增、乐观队列/重试的真实计数。
3. DIY 工作台和水晶库两入口、桌面/手机、三语与键盘/读屏；不可用状态有原因而非单纯灰按钮。
4. 原有 0 珠空托盘、首珠幂等、价格/库存/所有权/修订权威、历史 >60 展示及手串几何均保持。

## Task 0 — SOL 登记、基线与依赖确认（不改运行时代码）

**Owner:** SOL / Codex。**Exact files:** `docs/tasks/TASK_REGISTRY.md` 中新行与被接纳任务状态行；相关控制文档只在其阶段任务明确授权时修改。**Prerequisite:** 本计划获产品所有者确认。

- [ ] 逐个登记下方 `CONTRACT`、`BACKEND`、`DATABASE`、`FRONTEND`、`QA` 五个任务；每个阶段只保留一个 `IN_PROGRESS` owner。检查 `TASK-UX-BRACELET-FE-001` 的路径锁和实际 `.test.tsx` 登记修复进展。
- [ ] 核对起点 commit、目标路径不存在脏改动、分支与专属工作树，记录最小基线测试。不要仅凭分支或工作树存在断定取得所有权。
- [ ] 先派 Contract 给 DeepSeek；Contract 独立验收并进入集成基线后，再派 Backend/Database 给 DeepSeek、Frontend 给 Qwen。Database 订单守卫可在 Backend 更新守卫完成之后衔接；Frontend 与这两个服务端阶段可并行，前提是共享常量已落地且彼此没有重叠路径。

## Task 1 — Contract：唯一上限常量与 API 文档

**Proposed owner:** DeepSeek V4.1 Flash / `CONTRACT`。**Candidate exact writable files:** 新建 `packages/design-contract/src/constants/diy-policy.ts`、`packages/design-contract/src/index.ts`、新建 `packages/design-contract/tests/diy-policy.test.ts`、`docs/DESIGN_CONTRACT_V1.md`、`docs/API_SPECIFICATION.md`。注册时以实际路径确认为准；不得改 Backend/Frontend/Database。**Dependency:** Task 0。

- [ ] RED：测试从包根导入公开 `DIY_MAX_BEAD_COUNT` 并断言严格等于 60；不存在导出时应因缺功能失败。测试 `DesignV1Schema` 仍能解析合法的 >60 历史快照，不误加 `.max(60)`。
- [ ] GREEN：只加入数值常量及公开导出；文档说明 DIY 更新/新订单限额、历史兼容和后续稳定错误码，不改 DTO/成功响应的结构。不要复制第二份 60 常量到其他包。
- [ ] 验证：`pnpm --filter @mystcrag/design-contract test`、`pnpm --filter @mystcrag/design-contract typecheck`、`node --test tests/architecture.test.mjs`、`CI=1 pnpm validate`、`git diff --check`。SOL 核对导出/历史解析/文档后才能为消费者解锁。

## Task 2 — Backend：更新拒绝与错误契约

**Proposed owner:** DeepSeek V4.1 Flash / `BACKEND`。**Candidate exact writable files:** `apps/backend/src/contracts/api-error.ts`、`apps/backend/src/modules/design/design-api.service.ts`、`apps/backend/src/modules/design/design.controller.ts`、`apps/backend/src/modules/design/design.routes.test.ts`、新建 `apps/backend/src/modules/design/diy-bead-cap.test.ts`（若共享 fixture 足够，可只使用已列旧测试文件）。若发现其他必需文件，先由 SOL 修改登记，执行者不得越界。**Dependency:** Task 1 已集成。

- [ ] RED：用服务层与真实 Fastify 路由测试覆盖 `59→60`、`60→61` HTTP 400 与错误封套、`60→60` 删除再加/等量替换、配饰不计、`REPLACE_COMPONENT` 配饰→珠子、旧 `70→69` 但旧设计任何新增均拒绝、并发同修订只有一次成功、他人设计不泄露。断言拒绝前价格/库存校验、持久化修订及使用事件均未发生；原有 `CONFLICT` 优先级不变。
- [ ] GREEN：在 `applyOperations` 的终态判定与 `update` 的持久化前实现上限；显式识别旧超限设计中的珠子新增，不能仅比较净数量。新增 Backend 错误枚举/HTTP 400 映射，并在 `design.controller.ts` 把下游同名 `PersistenceError` 映射为同名公开错误；复用既有封套，从共享常量导入，不复制数字。测试此映射不能退化为 `INTERNAL_ERROR`。
- [ ] 验证：`pnpm --filter @mystcrag/backend test`、`pnpm --filter @mystcrag/backend typecheck`、架构、全量 validate、diff check。接口文档若需更精确，只能在登记扩权后改，且与 Contract 文档同一合入序列复审。

## Task 3 — Database：订单事务内限额，不破坏旧订单重放

**Proposed owner:** DeepSeek V4.1 Flash / `DATABASE`。**Candidate exact writable files:** `packages/database/src/errors/persistence-errors.ts`、`packages/database/src/repositories/order.repository.ts`、新建 `packages/database/src/repositories/diy-bead-cap-order.repository.integration.test.ts`、`docs/DATABASE_SCHEMA.md`（仅记录订单事务守卫与无 schema 变更）。不改 Prisma schema/migration。**Dependency:** Task 1，且 Task 2 错误码/映射已冻结。与 Task 2 同一执行者可顺序交付，但必须独立 task/branch/工作树与验收。

- [ ] RED：在隔离 PostgreSQL 中构造 `DIY_CREATED` 当前 61 珠修订，断言新订单拒绝且无订单/库存预留；同修订的已有订单优先重放且快照不变；非 DIY 原有订单规则不变；60 珠正常创建。测试校验拒绝前不触发重定价/库存副作用。
- [ ] GREEN：在 `OrderRepository.createOrderFromDesign` 事务内，现有订单重放分支**之后**、新订单重定价及库存预留**之前**，校验当前 `DIY_CREATED` 快照的 `beads.length <= DIY_MAX_BEAD_COUNT`。扩展 `PersistenceErrorCode` 加入同名业务码，由 Task 2 已登记的 Backend mapper 传播至公开封套；不能降为通用错误。维持当前修订、所有者和幂等检查顺序。
- [ ] 验证：`pnpm --filter @mystcrag/database test` 与隔离 DB 集成测试、Database typecheck、Backend 路由订单回归、架构、全量 validate、diff check。没有隔离数据库时停在 REVIEW 并列出缺的证据，不声称事务门槛已验收。

## Task 4 — Frontend：两处手工加珠入口、三语与乐观恢复

**Proposed owner:** Qwen3.8-Flash / `FRONTEND`。**Candidate exact writable files:** `apps/frontend/src/features/design/components/diy-editor.tsx`、`apps/frontend/src/features/design/model/optimistic-design.ts`、`apps/frontend/src/features/design/model/optimistic-design.test.tsx`、`apps/frontend/src/features/library/components/crystal-library-page.tsx`、`apps/frontend/src/features/library/components/crystal-library-page.test.tsx`、`apps/frontend/src/lib/api/frontend-api-error.ts`、`apps/frontend/src/lib/api/design-api.ts`、`apps/frontend/src/lib/api/design-api.test.tsx`、`apps/frontend/src/i18n/messages/zh-CN.ts`、`zh-TW.ts`、`en-US.ts`（完整路径前缀相同）。如需新增 DIY 专项测试，先精确登记新路径；不得碰展示求解器、`flat-bracelet-editor.tsx`、`frontend-ai-flow.test.tsx` 等当前锁定文件。**Dependency:** Task 1 已集成且相关锁已释放；可与 Tasks 2–3 无重叠并行，最终 QA 等服务端入主基线。

- [ ] RED：测试工作台与水晶库 59/60/61，所有加入按钮及“同款/再加一颗”，已排队乐观添加计数、双击/重试、旧 >60 逐次删减与保存、服务器上限/冲突失败后的已确认状态恢复；测试三语、键盘、`aria-live`/状态说明和 320 px 不溢出。首珠和 0 珠入口保持既有测试。
- [ ] GREEN：从共享常量渲染 `当前/60`；在提交和乐观入队的共同边界拦住额外珠子，材料仍可浏览、换珠/移动/删珠/配饰仍可用；水晶库同步拦截。已知服务端错误码加入 `SERVER_CODES` 与前端呈现，并让当前显示语言决定可见文案。不要用设计固定 `locale` 当作显示语言，不改设计货币/价格，不以全局 `DesignV1` schema 拦截历史记录。
- [ ] 验证：定向 `tsx --test`（新旧五类测试），`pnpm --filter @mystcrag/frontend typecheck`、`pnpm --filter @mystcrag/frontend lint`、前端完整**显式加引号**测试 glob、架构、全量 validate、diff check。真实浏览器初验桌面和手机；截图、视口、commit 写入经登记的 QA 证据位置，而非随意新增仓库文件。

## Task 5 — QA：真实服务端双用户联验与收口

**Proposed owner:** DeepSeek V4.1 Flash / `QA`（或独立已登记 QA owner，不得兼任被审代码路径）。**Candidate exact writable files:** 新建 `scripts/ui-qa/test_diy_bead_cap.py`、新建 `scripts/ui-qa/capture_diy_bead_cap.py`、`docs/INTERACTION_TEST_PLAN.md` 中本规则行；忽略式证据位置按 `docs/governance/QA_EVIDENCE_RETENTION.md` 先登记。**Dependency:** Tasks 2–4 各自复审通过且集成；现有手串展示任务单独处理。

- [ ] 用隔离 PostgreSQL、真实 Backend、两名独立账号跑 0/1、59/60/61、快速双击与双标签修订、旧 70→69→60、保存/新订单/已有订单重放、三语切换和键盘读屏；桌面 1440 与手机 320/390 px 均保留截图、请求 ID、来源 commit、视口、无秘密的日志。
- [ ] 专门确认 API 直调绕过 UI 仍得 `DIY_BEAD_LIMIT_EXCEEDED`，拒绝不产生修订/价格/预留/订单；水晶库入口与 DIY 工作台一致。非 DIY 自动生成及已有订单回归不变；高密度历史预览仍交由独立展示任务验收。
- [ ] QA 测试、架构、`CI=1 pnpm validate`、文档路径、`git diff --check` 都有原始输出。SOL 独立核对证据和路径，只有全部接受后才把五个任务标记 DONE；任何一项失败直接写明复修文件范围、RED/GREEN 和验收命令供对应执行者处理，不自动合并或推送。

## Final Integration Gate

- [ ] SOL 依依赖顺序审阅并仅在获得明确合并授权时集成；以最终集成树重跑 Contract、Backend/Database、Frontend、架构、`CI=1 pnpm validate` 与真实浏览器核心路径，不用单分支绿色代替集成绿色。
- [ ] 核对 `git status --porcelain`、`git diff --check`、任务登记的可写路径及原有用户改动字节未被覆盖；记录提交 SHA、通过/失败/取消计数和未解决风险。推送 GitHub、部署、清理工作树各需单独授权。
