# Task 3 — GLM 图片流水线与 Worker 并行交接

> **For agentic workers:** Use `superpowers:executing-plans` if available. 用户手动分发，GLM 内联执行；不得自动启动其他 agent。此文补充已批准 Task 3，不重写完整实现计划。

**Goal:** 在 Task 2 PR 检查期间，以固定已验收数据库版本开发本地归档、分组、保真图片处理和租约 Worker。

**Architecture:** `packages/asset-pipeline` 提供本地文件与纯图像能力，`apps/asset-worker` 通过现有数据库仓储领取并完成任务。文件不进入 Git；后台 API、人工审批、商品发布和前端不属于本任务。

**Tech Stack:** TypeScript、Sharp、Node、现有 Prisma/PostgreSQL 仓储、pnpm/Turbo。沿用仓库测试工具，不无故引入新测试框架。

**Spec:** [批准设计](../specs/2026-08-31-bead-asset-import-assistant-design.md)；[完整实施计划的 Task 3](2026-08-31-bead-asset-import-assistant-implementation-plan.md#task-3-deterministic-image-pipeline-and-separate-local-worker)。

## 1. 负责人、基线与开工

- 实现任务唯一 ID：`TASK-ASSET-WORKER-001`；唯一负责人：GLM。
- 分支：`task/asset-worker-001-local-pipeline`。
- 独立 worktree：`/Users/chenyanyan/Codex-project/玄矶水晶DIY设计网页端/.worktrees/asset-worker-001`，由 GLM 领取时建立。若已存在，不覆盖、不重置，先核验归属和脏文件。
- 从本地 `task/asset-worker-plan-001-parallel-dispatch` 的已提交交接版本建立分支，记录完整起始 SHA；它必须包含 `ed03ba2dc05825cd6081fd6975ef5c23ca578ef2`，数据库实现祖先是 `8d66120dc533e30d6d7d0e2bf6ac8a3456cdee23`。不要从旧 main、旧 Task 2 初版或副本目录建立。
- READY 代表已允许领取，并不代表 GLM 已运行。GLM 开工前读取 README、AGENTS、docs/INDEX 和路由文档，核对无路径锁，在自己 worktree 仅把自己的任务行改成 IN_PROGRESS，提交领取记录后才改业务文件。
- SOL 仍只做计划、审核和归档；QWEN 当前不分发任务。取消的 Contract-002 不恢复。

## 2. Global constraints

- 只放宽“先合并再开始开发”；Worker 合入之前，Task 2 必须完成依赖集成，并针对最终依赖重跑验证。当前不是生产部署授权。
- 不改数据库、迁移、共享 Contract、后台 API、前端、认证、知识 Worker 和 PR #5 分支；不自动 push、merge、rebase 或删除分支/worktree。
- 若 PR #5 发生代码修正，暂停受影响仓储联调并交给 SOL 核对；不受影响的纯图片/存储测试可继续，不私自 cherry-pick 补丁。
- 图片身份由人工确认；禁止矿物/品质推断，禁止生成式补纹理、改真实色彩和虚假高清。
- 用户原片只读，默认仅用运行时生成的小型测试图片；不得批量扫描/转换桌面素材，不上传第三方，不提交图片、模型缓存、数据库、密钥或生成输出。
- skills 按必要性使用已有 `executing-plans`、`test-driven-development`、`verification-before-completion`；失败时用 `systematic-debugging`。没有对应 skill 就如实说明并执行等价流程，不为本任务自动安装。不要用 imagegen，图片处理必须可重复且保真。

## 3. 精确可写范围与依赖预检

可写范围与文件结构沿用完整计划 Task 3：`packages/asset-pipeline/**`、`apps/asset-worker/**`、`package.json`、`pnpm-lock.yaml`、`turbo.json`、`.env.example`、`docs/ASSET_PIPELINE.md`。另只允许修改登记表的 TASK-ASSET-WORKER-001 行用于领取与交付。根配置仅增加本任务所需内容，不升级无关依赖、不改现有脚本语义、不削弱门禁。

必须先阅读 `packages/database/src/repositories/asset-import.repository.ts` 及其测试、`docs/DATABASE_SCHEMA.md`、`docs/API_SPECIFICATION.md`、`packages/design-contract/src/schemas/bead-asset-import-api.schema.ts`。租约方法以实际实现为准：

```ts
claimNextJob(workerId: string, leaseUntil: Date): Promise<ClaimedAssetJob | null>
heartbeatJob(jobId: string, lease: AssetJobLease, leaseUntil: Date): Promise<boolean>
completeJob(jobId: string, result: CompleteAssetJobResult, lease: AssetJobLease): Promise<CompleteAssetJobOutcome>
failJob(jobId: string, error: AssetJobFailure, retryAt: Date | null, lease: AssetJobLease): Promise<FailAssetJobOutcome>
// AssetJobLease = { workerId: string; leaseToken: string }
```

这些类型从 `@mystcrag/database` 消费，不复制 Prisma 模型，不在 Worker 发 SQL 或导入 generated client。运行时必须验证 `ClaimedAssetJob.payload: unknown`，内部处理输入与公开 HTTP DTO 分开，文档说明由后续后台如何组装；不凭空声称尚未存在的 HTTP 路由可用。

预检要特别核对：任务创建/读取源文件的仓储支持、分组结果如何持久化、一次 PROCESS_GROUP 仅一个 output 与主图/缩略图双文件的关系。现有 completeJob 对 ARCHIVE_FILE/GROUP_SESSION 可记录任务结果，不等于自动完成全部文件/分组业务写入。发现不可通过现有公开仓储能力完成的持久化步骤，记录精确接口缺口并暂停该步骤；可继续纯流水线，不新增影子数据库或通过测试后门冒充生产链路。不得自行扩展 Task 2。

## 4. 分阶段执行与验收

- [ ] 按完整 Task 3 Step 1–2，先写文件头检测、跨目录同 stem 配对、哈希精确去重、缺失配对、损坏文件、路径穿越测试并确认红灯，再实现归档。
- [ ] 档案根目录必须配置且在所有相关 Git worktree 之外，解析真实路径并防符号链接越界。生成不可变 key，校验大小/哈希后原子落盘；重复 key 只可复用已校验内容，禁止同名覆盖。测试磁盘/写入失败、重试和源文件不变。
- [ ] 按完整 Task 3 Step 3 实现确定性分组建议：dHash、颜色直方图、弱时间/序列信号；记录阈值与依据，不把低置信度自动合并，不覆盖人工分组。
- [ ] 按完整 Task 3 Step 4 实现方向/颜色空间校正、外连背景蒙版、保留内部高光、有限降噪锐化、等比裁切居中，输出 512×512 与 256×256 透明 WebP。不得放大主体像素伪造细节：小主体可置于固定画布并报有效分辨率不足/建议重拍。
- [ ] 先写 QC 数值断言，再实现裁断、内部误透明、Alpha、白黑边、模糊、有效分辨率、颜色偏移和解码检查。固定处理版本/参数，定义像素或字节确定性范围；重试校验已有输出哈希，不凭文件存在就跳过。
- [ ] 按完整 Task 3 Step 5 实现领取、心跳、租约失效取消、有限重试、恢复和 SIGTERM。租约失效后不得继续提交结果；测试同一 workerId 重领的新 token 与旧 token 隔离。任务失败 retryAt 为 null 并不表示立即终止，按实际仓储重试上限处理。
- [ ] Worker 只上报输出和 QC；QC 通过仍为 QC_PENDING，不得调用 reviewProcessedAsset、publishGroup，或提交使用权限、公开 key、APPROVED。失败态映射到现有数据库/Contract 状态，不私造一个持久化 NEEDS_REVIEW 枚举。
- [ ] 更新 `docs/ASSET_PIPELINE.md`：先记录模块接口、存储布局、配置、处理/QC阈值与版本、启动/停止/恢复、内部 job payload、主图/缩略图关系、权限边界和已知缺口，再或同时实现对应代码。完整计划与设计中的布局示例不得发展成两套存储适配器。

新增接口先在上述文档写明并以模块测试消费；测试使用合成文件及独立 PostgreSQL 库。不得在业务代码中构造直连 Prisma 的兜底；若集成 fixture 需要新增数据库测试支撑而超出白名单，先报告 SOL，不擅自越权。

## 5. 交付验证和停止点

```sh
pnpm install --frozen-lockfile
pnpm --filter @mystcrag/asset-pipeline lint
pnpm --filter @mystcrag/asset-pipeline typecheck
pnpm --filter @mystcrag/asset-pipeline test
pnpm --filter @mystcrag/asset-worker lint
pnpm --filter @mystcrag/asset-worker typecheck
pnpm --filter @mystcrag/asset-worker test
pnpm validate
git diff --check
```

另外在从未用于业务的空测试库运行根 `pnpm db:test`，报告实际库名、PostgreSQL 版本、14 个迁移及测试数；不要把无数据库时的跳过当通过。Worker 测试必须证明真实仓储租约适配，不仅是 mock；若当前接口不足以合法布置测试，提交阻塞说明而非声称整项完成。

交付包含：起始和最终 SHA、分支/worktree、相对起始 SHA 的逐文件 diffstat、红绿测试证据、实际命令/退出码/数量、缓存与实际执行分列、存储与无原片提交检查、接口缺口与后续依赖。报告写入 `docs/ASSET_PIPELINE.md` 的任务交付部分，避免未登记文件。

完成后任务只转 REVIEW，等待 SOL；若持久化预检阻塞，标 BLOCKED 并说明已完成的独立部分。不得宣称完整导入业务可用，不推送、不合并、不开始 Task 4，不批量处理桌面原片。
