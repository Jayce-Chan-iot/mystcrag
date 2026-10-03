# DIY 入口与设计所有权实施计划

> **供执行代理使用：** 必须逐任务使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`；用 `- [ ]` 跟踪步骤。每个任务先在 `TASK_REGISTRY.md` 登记唯一 owner、分支、精确可写路径并置为 `IN_PROGRESS`。

**目标：** 所有 DIY 入口进入当前用户拥有的设计；直接进入时安全、幂等地创建个人起始草稿。

**架构：** Contract → Database → Backend → Frontend 串行落地。沿用 BFF Cookie、`AuthenticatedActorProvider`、`DesignRepository`、`DesignApiService` 与 `PublicDesignV1`；不以固定设计 ID、浏览器用户 ID 或绕过鉴权解决问题。

**技术栈：** Next.js 16、React 19、Fastify、Zod、Prisma/PostgreSQL、TypeScript、tsx 测试。

**规格：** [已批准的中文设计规格](../specs/2026-10-03-star-platform-ux-remediation-design.md) §2、§5.1、§8。

## 全局约束

- 现有 `DesignV1` 至少一颗珠子；本计划不改该约束。新草稿用一颗当前目录可售的真实珠子起步，界面明确“起始材料，可继续搭配”；若产品所有者要求空托盘，须另立 Design Contract 任务，不能让客户端伪造空 `DesignV1`。
- 初始 155 mm 只标为“待确认的工作尺寸”，不是已测得的用户腕围；价格、库存、最终适配仍由服务端复核。
- 同一用户、同一 `requestId` 的创建/网络重试返回同一设计；同键不同请求内容冲突；不同用户绝不共享。
- 未登录保持合法 `returnTo=/diy`；跨用户设计仍拒绝访问，不能暴露是否存在。
- 不改问卦随机性、现有个人设计、订单或作者权威；每步先红后绿，最终 `pnpm validate`。

## 评审重点

1. 双击与网络响应丢失：同一 `requestId` 仅一份草稿（任务 2、3、4 的测试）。
2. 另一用户猜中旧固定 ID：继续 403/owner-safe，无法读取、克隆或编辑（任务 3、4）。
3. 库存刚归零：不生成虚假可售珠子，显示可重试错误（任务 3、4）。
4. 旧个人设计深链：仍进入原设计且不偷偷创建新草稿（任务 4）。
5. 未登录直达：登录后回到 `/diy`，不把未经验证的 actorId 带入请求（任务 4）。

---

### 任务 1：冻结起始草稿公共契约（登记 owner `GLM`，模块 `CONTRACT`）

**文件：** 修改 `packages/design-contract/src/schemas/api-dto.schema.ts`、`packages/design-contract/src/index.ts`、`docs/API_SPECIFICATION.md`、`docs/DESIGN_CONTRACT_V1.md`；新增 `packages/design-contract/tests/diy-draft-contract.test.ts`。

**接口：** `CreateDiyDraftRequestSchema` = 严格对象 `{ requestId: Identifier, locale: Locale, currency: Currency }`；`CreateDiyDraftResponseSchema` = `{ requestId, design: PublicDesignV1, warnings }`；导出相应推断类型。路由定为 `POST /api/design/diy-draft`。工作尺寸由服务端配置，不让请求冒充用户测量。

- [ ] 写失败测试：合法请求/响应可解析；额外 `actorId` 或 `beadProductId` 字段拒绝；`requestId` 必填；响应设计必须 `DIY_CREATED`、`PRIVATE` 且符合 `PublicDesignV1`。
- [ ] 运行 `pnpm --filter @mystcrag/design-contract exec tsx --test tests/diy-draft-contract.test.ts`，确认新增断言因缺 schema/export 失败。
- [ ] 实现 schema/export 与 API/DesignV1 文档；不改旧 Generate/Clone DTO。
- [ ] 重跑同一测试及 `pnpm --filter @mystcrag/design-contract typecheck`，两者通过。
- [ ] 按登记路径提交 `feat(contract): define owner-scoped DIY draft creation`。

### 任务 2：原子化创建与重放（登记 owner `GLM`，模块 `DATABASE`）

**文件：** 修改 `packages/database/prisma/schema.prisma`、新增对应 migration、`packages/database/src/repositories/design.repository.ts`、`docs/DATABASE_SCHEMA.md`；新增 `packages/database/src/repositories/design-draft.repository.unit.test.ts` 与 `design-draft.repository.integration.test.ts`。

**接口：** `DesignRepository.createDraftIdempotently(actorId: string, requestId: string, fingerprint: string, snapshot: DesignV1): Promise<PersistedDesign>`。`Design` 添加 nullable `creationRequestId`、`creationRequestFingerprint` 与唯一 `(ownerId, creationRequestId)`；已有设计保持 null。指纹只覆盖合法业务请求字段。

- [ ] 写失败测试：同 actor/键重复与并发创建只得到相同设计 ID、仅一个 revision 1；同键异指纹冲突；不同 actor 的相同键分离；旧行仍可读取。
- [ ] 运行 `pnpm --filter @mystcrag/database exec tsx --test src/repositories/design-draft.repository.unit.test.ts`；集成测试按现有 `pnpm db:test` 测试数据库流程执行，记录红因。
- [ ] 实现 migration 和单事务插入/唯一冲突后读取；重放前比对指纹，不复用其他 actor 的结果。
- [ ] 运行 `pnpm --filter @mystcrag/database db:generate`、上述单测/集成测试与 typecheck，均通过。
- [ ] 提交 `feat(database): make DIY draft creation idempotent`。

### 任务 3：后端当前用户草稿服务（登记 owner `GLM`，模块 `BACKEND`）

**文件：** 修改 `apps/backend/src/modules/design/design-api.service.ts`、`apps/backend/src/modules/design/design.routes.ts`、`apps/backend/src/modules/design/design.routes.test.ts`、`docs/governance/FEATURE_REGISTRY.md` 中 DIY 生产入口；必要时在同模块新增 `diy-draft.test.ts`。只在实际接口改变时同步 `docs/API_SPECIFICATION.md` 的确切接口段（与任务 1 串行）。

**接口：** `DesignApiService.createDiyDraft(actorId: string, request: CreateDiyDraftRequest): Promise<CreateDiyDraftResponse>`；从已验证 actor 获得 owner，不接收浏览器 owner ID。选择稳定排序的第一款当前可售真实目录 SKU，用现有设计组装/权威定价边界得到一颗珠子的 `DIY_CREATED` 私有 revision 1；无可售 SKU 则返回稳定可恢复错误，不持久化草稿。入库交任务 2 接口。

- [ ] 写失败测试：401、双用户隔离、同键重放/并发、异载荷冲突、零库存、目录价格变化与读回 owner-scoped 设计。
- [ ] 运行 `pnpm --filter @mystcrag/backend exec tsx --test src/modules/design/design.routes.test.ts`，确认新增断言失败。
- [ ] 增加受保护路由和最小服务逻辑；不能从 `design-diy-private` 或客户端价格复制权威字段。
- [ ] 重跑目标测试、`pnpm --filter @mystcrag/backend typecheck` 和 `node --test tests/architecture.test.mjs`，均通过。
- [ ] 提交 `feat(backend): create actor-owned DIY starter draft`。

### 任务 4：统一客户入口与失败恢复（登记 owner `QWEN`，模块 `FRONTEND`）

**文件：** 修改 `apps/frontend/app/diy/page.tsx`、`apps/frontend/src/lib/api/design-api.ts`、`apps/frontend/src/lib/api/design-api.test.tsx`、`apps/frontend/src/features/library/components/crystal-library-page.tsx`、`apps/frontend/src/features/library/components/crystal-library-page.test.tsx`、`apps/frontend/src/features/design/components/diy-editor.tsx`；新增 `apps/frontend/src/features/design/components/diy-entry.tsx` 及同名测试（若使用 server-side BFF 调用，则在同任务注册对应 server file）。

**接口：** `designApi.createDiyDraft(requestId: string, locale: Locale, currency: Currency): Promise<CreateDiyDraftResponse>`；`DiyEntry` 持有一次启动的请求键、单航班 Promise 与导航恢复；`/diy/[id]` 仍只按所有者读取指定 ID。水晶库的无设计状态转到 `/diy`，不再请求固定 ID。

- [ ] 写失败测试：主页/导航/水晶库/问卦方案/个人设计五种入口；双击、重试、401 登录返回、403 别人设计恢复按钮、旧设计深链与无 SKU 错误。
- [ ] 运行 `pnpm --filter @mystcrag/frontend exec tsx --test src/lib/api/design-api.test.tsx src/features/library/components/crystal-library-page.test.tsx src/features/design/components/diy-entry.test.tsx`，确认新增断言失败。
- [ ] 实现 API、入口和恢复文案；仅对“创建草稿”重用本次请求键，成功后清除，刷新不覆盖旧设计。
- [ ] 重跑目标测试、前端 typecheck/lint，并在两名测试用户的浏览器流程中验证全部入口；证据放受控 QA 路径。
- [ ] 提交 `fix(frontend): route DIY entry to the current owner's draft`。

**交接门槛：** Contract/Database/Backend/Frontend 顺序合入后，QA 复验两用户、重试、深链及库存；`pnpm validate`、架构测试、`git diff --check` 全通过。产品所有者先确认后续效果图，再开展大面积视觉修改。
