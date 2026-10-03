# DIY 空托盘入口与设计所有权 Implementation Plan

> **供执行代理使用：** REQUIRED SUB-SKILL：逐任务使用 `superpowers:executing-plans`；用 `- [ ]` 跟踪步骤。GPT 先串行登记唯一 owner、`task/<task-id>-<slug>` 分支、独立工作树和精确可写路径，并置为 `IN_PROGRESS`；执行者不编辑任务注册表。GPT 只审查和下发，不写实现代码。

**Goal / 目标：** 所有 DIY 入口进入当前用户的历史选择或完全空的全新托盘；仅在选择第一颗真实珠子后安全、幂等地创建其个人设计。

**Architecture / 架构：** `/diy` 用现有 owner-scoped `GET /api/designs` 决定“继续历史 / 开始新设计”；空托盘只是前端临时状态，不构造、不保存零珠 `DesignV1`。首珠请求按 Contract → Database → Backend → Frontend 串行落地；后端以已验证 actor、真实目录和权威定价原子生成一珠 `DesignV1` revision 1，随后进入既有 `/diy/[id]` 和 `DiyEditor`。

**Tech Stack / 技术栈：** Next.js 16、React 19、Fastify、Zod、Prisma/PostgreSQL、TypeScript、tsx 测试。

**Spec / 规格：** [已批准的中文设计规格](../specs/2026-10-03-star-platform-ux-remediation-design.md) §2、§5.1–5.3、§8。

## 全局约束

- 全新托盘必须完全为空。首珠前没有设计 ID、修订、报价或“已保存”状态，保存和完成动作明确提示先选择第一颗珠子。
- 保持现有 `DesignV1` 至少一珠约束；空托盘只是临时前端状态，不增加零珠持久化特例，也不预放目录珠子。
- 有历史设计时先提供“继续已有设计 / 开始新设计”；无历史时直接进入空托盘。历史列表仅使用当前 actor 的 `GET /api/designs`。
- 初始 155 mm 只标为“待确认的工作尺寸”，不是已测得的用户腕围；价格、库存、最终适配仍由服务端复核。
- 同一用户、同一 `requestId` 的创建/网络重试返回同一设计；同键不同请求内容冲突；不同用户绝不共享。
- 未登录保持合法 `returnTo=/diy`；跨用户设计仍拒绝访问，不能暴露是否存在。
- 不改问卦随机性、现有个人设计、订单或作者权威；每步先红后绿，最终 `pnpm validate`。

## 评审重点

1. 无历史与有历史：前者直接见空托盘，后者能选择继续或新开；任务 4 测试。
2. 双击、响应丢失与目录随后变化：同一 `requestId` 只返回原有一珠设计和 revision 1，不再次组装、查库存或定价（任务 2、3、4 的测试）。
3. 库存刚归零：不生成虚假可售珠子，保留空托盘和选珠意图（任务 3、4）。
4. 另一用户猜中旧固定 ID 或未登录直达：继续 owner-safe 拒绝或登录恢复（任务 3、4）。
5. 首珠前保存/完成、刷新、语言切换：不生成零珠 `DesignV1`、伪报价或自动预放珠；刷新可按当前历史列表重新展示选择器或空托盘（任务 4）。

---

### 任务 1：冻结首珠创建契约（拟登记 `TASK-UX-DIY-CONTRACT-001`；DeepSeek V4.1 Flash / `CONTRACT`）

**文件：** 修改 `packages/design-contract/src/schemas/api-dto.schema.ts`、`packages/design-contract/src/index.ts`、`docs/API_SPECIFICATION.md`、`docs/DESIGN_CONTRACT_V1.md`；新增 `packages/design-contract/tests/diy-first-bead-contract.test.ts`。其他路径禁止写入。

**接口：** `CreateDiyFirstBeadRequestSchema` = 严格对象 `{ requestId: Identifier, beadProductId: Identifier, locale: Locale, currency: Currency }`；`CreateDiyFirstBeadResponseSchema` = `{ requestId, design: PublicDesignV1, warnings }`；导出相应推断类型。路由定为 `POST /api/design/diy-first-bead`。请求不含 owner、价格、库存、revision 或伪造珠对象；响应是恰好一珠的私有 `DIY_CREATED` revision 1。

- [ ] 写失败测试：合法请求/响应可解析；缺少 `beadProductId`、额外 `actorId`/`unitPriceMinor`、零珠响应均拒绝。
- [ ] 运行 `pnpm --filter @mystcrag/design-contract exec tsx --test tests/diy-first-bead-contract.test.ts`，确认新增断言因缺 schema/export 失败。
- [ ] 实现 schema/export 与 API/DesignV1 文档；明确空托盘只存在前端，不改旧 Generate/Clone DTO 或 DesignV1 至少一珠校验。
- [ ] 重跑同一测试及 `pnpm --filter @mystcrag/design-contract typecheck`，两者通过。
- [ ] 按登记路径提交 `feat(contract): define first-bead DIY creation`。

### 任务 2：首珠原子创建与重放（拟登记 `TASK-UX-DIY-DB-001`；DeepSeek V4.1 Flash / `DATABASE`；依赖任务 1）

**文件：** 修改 `packages/database/prisma/schema.prisma`、新增对应 migration、`packages/database/src/repositories/design.repository.ts`、`docs/DATABASE_SCHEMA.md`；新增 `packages/database/src/repositories/diy-first-bead.repository.unit.test.ts` 与 `diy-first-bead.repository.integration.test.ts`。其他路径禁止写入。

**接口：** `DesignRepository.findFirstBeadByRequest(actorId: string, requestId: string, fingerprint: string): Promise<PersistedDesign | null>` 用于业务副作用前重放；`DesignRepository.createFirstBeadIdempotently(actorId: string, requestId: string, fingerprint: string, snapshot: DesignV1): Promise<PersistedDesign>` 用于事务创建及并发唯一冲突回读。`Design` 添加 nullable `creationRequestId`、`creationRequestFingerprint` 与唯一 `(ownerId, creationRequestId)`；已有设计保持 null。指纹只覆盖 `beadProductId,locale,currency`，不依赖显示语言 Cookie。

- [ ] 写失败测试：同 actor/键重复与并发只一行、一份 revision 1；创建后的 owner-scoped lookup 返回原快照；同键异指纹冲突；不同 actor 同键分离；旧行仍可读；零珠 snapshot 拒绝。
- [ ] 运行 `pnpm --filter @mystcrag/database exec tsx --test src/repositories/diy-first-bead.repository.unit.test.ts`；集成测试按现有 `pnpm db:test` 隔离测试库流程执行，记录红因。
- [ ] 实现 migration、单事务插入及唯一冲突后的 owner-scoped 读回与指纹比对；不持久化零珠状态。
- [ ] 运行 `pnpm --filter @mystcrag/database db:generate`、上述单测/集成测试与 typecheck，均通过。
- [ ] 提交 `feat(database): deduplicate first-bead creation`。

### 任务 3：后端当前用户首珠服务（拟登记 `TASK-UX-DIY-BE-001`；DeepSeek V4.1 Flash / `BACKEND`；依赖任务 2）

**文件：** 修改 `apps/backend/src/modules/design/design-api.service.ts`、`apps/backend/src/modules/design/design.routes.ts`、`apps/backend/src/modules/design/design.routes.test.ts`、`docs/governance/FEATURE_REGISTRY.md` 中 DIY 生产入口；新增同模块 `diy-first-bead.test.ts`。API 文档由任务 1 拥有，本任务只核对实现一致性；其他路径禁止写入。

**接口：** `DesignApiService.createDiyFirstBead(actorId: string, request: CreateDiyFirstBeadRequest): Promise<CreateDiyFirstBeadResponse>`；actor 只来自已验证身份。先以任务 2 的 lookup 判定同键同内容重放并返回原设计；仅首次创建才按用户实际点选的 `beadProductId` 校验当前活跃/库存/币种，用现有组装与权威定价边界生成恰好一颗珠子的私有 `DIY_CREATED` revision 1，再调用幂等事务创建。无可售 SKU 时返回可重试错误，不持久化草稿。

- [ ] 写失败测试：401、双用户隔离、同键重放/并发、同键异材料、首次零库存/下架、币种不符、原请求在目录价格或库存变化后仍重放原设计且不重新定价、读回 owner-scoped 设计。
- [ ] 运行 `pnpm --filter @mystcrag/backend exec tsx --test src/modules/design/design.routes.test.ts src/modules/design/diy-first-bead.test.ts`，确认新增断言失败。
- [ ] 增加受保护路由和最小服务逻辑；不能从 `design-diy-private`、随机预放 SKU 或客户端价格复制权威字段。
- [ ] 重跑目标测试、`pnpm --filter @mystcrag/backend typecheck` 和 `node --test tests/architecture.test.mjs`，均通过。
- [ ] 提交 `feat(backend): create owned DIY design on first bead`。

### 任务 4：历史选择与真正空工作台（拟登记 `TASK-UX-DIY-FE-001`；Qwen 3.8 Flash / `FRONTEND`；依赖任务 3）

**文件：** 修改 `apps/frontend/app/diy/page.tsx`、`apps/frontend/src/lib/api/design-api.ts` 及测试、`apps/frontend/src/features/library/components/crystal-library-page.tsx` 及测试、`apps/frontend/src/features/design/components/diy-editor.tsx`（仅现有深链的失败恢复）；新增 `apps/frontend/src/features/design/components/diy-entry.tsx`、`diy-empty-workbench.tsx` 及相邻测试。若其他入口链接确需修改，先登记具体文件并确认无锁，不以 `apps/frontend/**` 通配取得写权。

**接口：** `designApi.createDiyFirstBead(request: CreateDiyFirstBeadRequest): Promise<CreateDiyFirstBeadResponse>`；`DiyEntry` 使用 `designApi.listDesigns()` 展示当前用户历史，按服务端状态仅给可编辑记录“继续设计”，归档/不可编辑记录不冒充可操作；`DiyEmptyWorkbench` 复用已有目录与珠材视觉映射，内部状态为 `EMPTY | CREATING | ERROR`，绝不构造 `PublicDesignV1`。首次点珠维持单航班和同一 `requestId`；服务端成功后才导航 `/diy/${design.designId}`。水晶库无设计状态转 `/diy`，不再请求固定 ID；`/diy/[id]` 只读取所有者。

- [ ] 写失败测试：0/1/多份历史、归档记录不误显“继续”、继续自有设计、新开空托盘、五类入口、双击/重试、401 返回、403 他人深链、首珠前保存/完成不可用、切换语言不创建设计。
- [ ] 运行 `pnpm --filter @mystcrag/frontend exec tsx --test src/lib/api/design-api.test.tsx src/features/design/components/diy-entry.test.tsx src/features/design/components/diy-empty-workbench.test.tsx`，确认新增断言失败。
- [ ] 实现历史选择、空托盘与恢复文案；同一次首珠意图复用请求键，成功后清除，失败保留选珠意图；不新增第二套设计 store 或弱化鉴权。
- [ ] 重跑目标测试、前端 typecheck/lint/build、`pnpm validate`，并在两名测试用户的浏览器流程中验证全部入口；证据放受控 QA 路径。
- [ ] 提交 `feat(frontend): start DIY from empty tray with history choice`。

**交接门槛：** GPT 逐项核对单 owner、独立工作树、精确 diff 和红绿证据；Contract/Database/Backend 顺序合入后才下发 Qwen 前端任务。QA 复验两用户、无历史、有历史、首珠重放、深链和库存；`pnpm validate`、架构测试、`git diff --check` 全通过。产品所有者确认后续效果图后才开展大面积视觉修改。
