# TASK-ASSET-DB-001 交付报告（最终补正版）— 珠子素材导入的草稿持久化、任务租约、事务发布与 QC/人工批准分离

- **Status:** REVIEW（等待 SOL 审核）
- **执行者:** GLM（数据库 / 持久化 / 数据一致性）
- **分支:** `task/asset-db-001-draft-persistence`
- **Worktree:** `/Users/chenyanyan/Codex-project/玄矶水晶DIY设计网页端/.worktrees/asset-db-001`
- **开工前核验（初版轮记录）:** `git branch --show-current` = `task/asset-db-001-draft-persistence`，`git rev-parse HEAD` = `3bd0361`，`git status --short` 为空。
- **提交链:** `3bd0361`（开工基线）→ `2609a42`（初版交付）→ `4b825ac`（SOL 复审修复轮）→ **`8d66120`（最终轮，本报告权威状态）**
- **最终 commit:** `8d66120dc533e30d6d7d0e2bf6ac8a3456cdee23` — `fix(database): separate asset qc from human approval`
- **最终净差异:** 8 个文件，+6784 / −4（`git diff --stat 3bd0361..HEAD`）
- **未 merge、未建 PR、未 push、未开始 Task 3、未修改业务代码（本补正轮仅更新本报告）。**

> 本报告取代此前各轮报告中的 SHA、测试计数与结论（初版报告原文的 156 项测试、`2609a42` 等数字自此作废）。修复轮明细见 `task-2-sol-fix-report.md`；该报告中「请 SOL 拆出 QWEN Contract 修订任务」的表述已被本轮 SOL 指令取代——**QWEN Contract 补丁任务已取消**（见「Contract 缺口」节）。

## 交付摘要（最终状态）

| 项 | 最终状态 |
| --- | --- |
| 数据库测试（全新空库全量 `db:test`） | **178/178 通过**（0 fail / 0 skipped） |
| 资产导入集成矩阵 | **20/20 子场景通过**（单文件复跑：node:test 计 21 项 = 1 顶层 + 20 场景，全过） |
| 单元测试 | 106/106（36 既有 + 70 新增） |
| 最终迁移总数 | **14**（磁盘与 `_prisma_migrations` 双重核对） |
| 资产导入迁移 | **仅 `20260831_add_bead_asset_import` 一个完整迁移**（中间迁移 20260902 已合并删除） |
| QC 与人工批准 | **已分离**：QC 通过只进 QC_PENDING；未人工批准素材不可发布、不可公开读取 |
| `pnpm validate` | 15/15 任务成功 |

## 精确变更文件（8 个，最终净差异）

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | `packages/database/prisma/schema.prisma` | 9 个新模型、10 个新 enum；`ProcessedAsset` 增加人工批准列（`usagePermission @default(UNKNOWN)`、`rightsHolder`、`allowAiTraining`、`allowAiRecommendation`）；全部为增量追加 |
| 新增 | `packages/database/prisma/migrations/20260831_add_bead_asset_import/migration.sql` | 336 行，**单一完整资产导入迁移**：9 表 + 10 enum + 全部索引/外键 + 全部 hardening 列（lastModifiedMs、skippedFileCount、CrystalDraft 人工整理列、BeadGroupPublication 决策列与 3 个 Restrict 外键、ProcessedAsset 批准列），仅 `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` / `ADD CONSTRAINT` |
| 新增 | `packages/database/src/repositories/asset-import.repository.ts` | 1797 行，`AssetImportRepository` 窄接口（含 `reviewProcessedAsset` 人工审核持久化方法） |
| 新增 | `packages/database/src/repositories/asset-import.repository.unit.test.ts` | 2353 行，70 个新用例（内存 Prisma double） |
| 新增 | `packages/database/src/repositories/asset-import.repository.integration.test.ts` | 1824 行，真实 PostgreSQL 矩阵（1 个顶层测试 × **20 个编号子场景**） |
| 修改 | `packages/database/src/index.ts` | +1 行：`export * from "./repositories/asset-import.repository.js"` |
| 修改 | `packages/database/src/repositories/persistence.integration.test.ts` | **白名单外机械伴随变更（净 1 行）**，见下 |
| 修改 | `docs/DATABASE_SCHEMA.md` | 新增/更新 "Bead asset import persistence (TASK-ASSET-DB-001)" 章节：单一迁移语义、QC/人工批准分离、Contract blocker、fail-closed 行为 |

**白名单偏差声明（1 处，机械性，保留申报）：** `persistence.integration.test.ts` 断言磁盘迁移名单与 `_prisma_migrations` 精确一致（既有 13 个迁移的精确数组）。新增资产导入迁移必然使该断言失败，故按历史先例（commit `78fe84d` 加 `20260825100000_add_external_identities` 时的同一单行模式）在数组末尾追加 `"20260831_add_bead_asset_import"`。相对开工基线 `3bd0361`，该文件**最终净变更恰好 1 行**（修复轮曾追加 20260902 名单行、最终轮随迁移删除还原，增减相抵）。无任何其他白名单外文件被触碰。

## QC 与人工批准分离（最终轮核心变更）

**Worker 只能记录处理输出与自动 QC 结果。** `CompleteProcessGroupJobResultSchema` 为 strictObject 且仅含 `kind` / `processingVersion` / `output` / `qc`：worker 结果携带 `usagePermission`、`rightsHolder`、`isAuthenticPhotograph`、`allowPublicDisplay`、`allowCommercialUse`、`allowAiTraining`、`allowAiRecommendation` 任一字段 → `VALIDATION_ERROR`，发生在任何数据库写入之前（单测与集成场景 20 均断言被拒后零资产行落库）。

**QC 通过只能进入待人工审核状态。** `applyProcessGroupResult` 对 QC 通过创建 `state=QC_PENDING`、`assetKey=null`、`approvedAt=null` 的资产，权限列显式写入中性默认（UNKNOWN / null / false）——worker 完成不可能留下「已批准形状」的行。QC 失败仍为 `QC_FAILED` 且非当前版本。

**明确的人工审核持久化方法。** `reviewProcessedAsset(assetId, decision)`：先以本地 strictObject schema 校验决策（7 字段全必填），再在单事务内以单条条件 UPDATE（`id + state=QC_PENDING + isCurrentVersion + qcPassedAt IS NOT NULL`）原子授予 `APPROVED`、从已存储的 output digest 铸造内容寻址 `assetKey`、写入运营者全部权限决策；资产不存在 → `NOT_FOUND`，重复审核 / QC 失败 / 从未过 QC / 非当前版本 → `CONFLICT`。

**Fail closed（Contract 修订落地前的强制行为）：** 未人工批准素材——
1. 状态不是 APPROVED（停留 QC_PENDING）；
2. `publishGroup` 返回 `COMPLIANCE_BLOCKED`（不存在 approved 当前版本，产品/发布记录零落库）；
3. `findApprovedPublicAsset` 返回 null（即使伪造 assetKey 与 APPROVED 绑定也不可见）。

## Contract 缺口（不得宣称这些 API 已可用）

1. **人工审核 API 缺口：** 已验收 design-contract（`bead-asset-import-api.schema.ts`）不含 processed-asset 人工审核 DTO。`reviewProcessedAsset` 仅是数据库层的持久化方法——**没有 Contract DTO、没有 HTTP/API 面，人工审核 API 未可用**。
2. **CrystalDraft 完善 API 缺口：** `SaveBeadProductDraftRequestSchema` 不含晋升门禁所需的 8 项人工整理字段（非空 `nameCn`/`nameEn`、真实 `mineralName`、`colorTags`/`visualTags`/`styleTags` 各至少 1 个、`priceLevel`、真实 `complianceNote`）。API 路径无法向草稿传递这些字段，晋升保持 fail closed（`COMPLIANCE_BLOCKED`，不产生占位正式 Crystal）——**CrystalDraft 完善 API 未可用**。
3. **QWEN Contract 补丁任务已取消**（来源：本轮 SOL 指令，非本人执行记录）。上述两个缺口当前**无排期解决路径**；在 Contract 层另行决策之前，两条路径保持 fail closed，本报告不宣称这些 API 已可用或即将可用。

## 迁移与数据安全（最终状态）

- **最终迁移总数 14**（磁盘核对 `ls packages/database/prisma/migrations | grep -v migration_lock.toml | wc -l` = 14；`_prisma_migrations` 侧由集成场景 1 与 `ASSET_IMPORT_VERIFICATION_ENV migrations=14` 输出双重印证）。资产导入**只保留 `20260831_add_bead_asset_import`**。
- **中间迁移 `20260902_harden_asset_import_persistence` 的处置：** 该迁移曾在修复轮引入，因给已有 `bead_group_publications` 追加无默认值 NOT NULL 列而导致升级失败（P3018/23502，**来源：SOL 复审发现，非本人执行记录**）。最终轮将其全部 schema 变更合并回 20260831 的 CREATE TABLE / FK 定义并删除该迁移。两个实现提交（`2609a42`、`4b825ac`）均未推送、未合并、功能未部署，**不存在需要升级的已部署数据库，未删除或修改任何生产数据**；全新空库从零迁移为唯一受支持路径（已在 fixr4/fixr5 两个全新空库完整验证）。
- **破坏性语句扫描：** migration.sql 中 `DELETE`/`DROP`/`TRUNCATE` 匹配全部为外键子句 `ON DELETE RESTRICT`；排除后为 0——无任何 `DROP TABLE`、`DROP COLUMN`、`TRUNCATE`、`DELETE FROM`、`ALTER … DROP`。
- **外键策略：** 所有新外键（含 `AssetSourceFile.duplicateOfId` 自引用、`BeadGroupPublication` → product/crystal/snapshot 三个证据外键）显式 `Restrict` on delete & update。

## 测试结果（最终状态）

### 单元（内存 double）

```
$ pnpm --filter @mystcrag/database test
ℹ tests 106   ℹ pass 106   ℹ fail 0
```

106 = 36 既有 + 70 新增（初版 54 + 修复轮 10 + 最终轮 6）。新增用例覆盖：输入验证不触碰数据库、合法/非法状态转换矩阵、manifest fingerprint 与 hash 冲突、group revision CAS、lease CAS（含 leaseToken 比对）、retryCount 与终态、草稿保存与完整性回读、发布幂等/冲突、approved-only 查询四条件、QC 停留 QC_PENDING、worker 权限字段被拒、`reviewProcessedAsset` 批准/拒绝矩阵、未批准不可发布/不可查询。

### 资产导入集成矩阵（真实 PostgreSQL，20/20）

在全新空库 `mystcrag_assetdb001_fixr5_test_20260903` 上单独复跑该矩阵文件（本人执行记录）：

```
$ DATABASE_URL="postgresql://chenyanyan@localhost:5432/mystcrag_assetdb001_fixr5_test_20260903?schema=public" \
    pnpm --filter @mystcrag/database exec prisma migrate deploy
All migrations have been successfully applied.

$ DATABASE_URL="…mystcrag_assetdb001_fixr5_test_20260903…" \
    pnpm --filter @mystcrag/database exec tsx --test src/repositories/asset-import.repository.integration.test.ts
ℹ tests 21   ℹ pass 21   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0
# 21 = 1 顶层（live PostgreSQL bead asset import persistence matrix）+ 20 个编号子场景
# 场景输出逐行确认 1–20 全部 ✔；ASSET_IMPORT_VERIFICATION_ENV migrations=14 tables=33 indexes=29
```

| # | 场景 | 证明的属性 |
| --- | --- | --- |
| 1 | the bead asset import migration is additive and finished | 9 表 + 全部索引存在；20260831 已记录且 finished；**断言 20260902 不存在**；合并列（lastModifiedMs、skippedFileCount、CrystalDraft 整理列、发布决策列、ProcessedAsset 批准列）齐备 |
| 2 | session creation is idempotent, including a concurrent race | 同 `idempotencyKey` 重复创建返回同一 session；并发双写由唯一约束裁决 |
| 3 | manifest registration is idempotent and conflicting retries are rejected | 相同 manifest 重试返回原 `fileId`s；同 key 异 manifest → `CONFLICT` |
| 4 | upload archival deduplicates exact SHA-256 repeats inside one session | 相同 SHA-256 标记 `SKIPPED_DUPLICATE` 指向原件；`skippedFileCount` 与 `failedFileCount` 互斥 |
| 5 | two concurrent workers can never claim the same job | `FOR UPDATE SKIP LOCKED`，两连接一得一空 |
| 6 | an expired lease is reclaimed and the stale worker is rejected | 过期租约可被重领；旧 worker 的 heartbeat / complete / fail 全被拒 |
| 7 | failJob retries with backoff and fails terminally after max retries | retryCount 递增、retryAt 写入、超限终态 FAILED |
| 8 | the full pipeline publishes one group transactionally | 端到端：session→manifest→archive→claim→complete(QC)→**review(人工批准)**→draft→publish |
| 9 | publication replays idempotently and conflicting replays are rejected | 同 key 同 payload 重放返回原结果；同 key 异 payload → `CONFLICT` |
| 10 | one product binds both its texture and its model asset | 部分唯一索引下一个产品同时持有一个 TEXTURE 与一个 MODEL 批准绑定 |
| 11 | a failing inventory append rolls back the whole publication | 快照唯一约束冲突 → 发布事务整体回滚 |
| 12 | approved-only public lookup hides drafts, retired and private assets | DRAFT/QC_PENDING/QC_FAILED/RETIRED/非当前/私有/未绑定变体全部 null |
| 13 | PostgreSQL enforces the partial unique invariants directly | 绕过 repository 直接写入，三个部分唯一索引由 PostgreSQL 自身强制 |
| 14 | foreign keys restrict deletion across the import graph | 删除被引用的 session/group/product/snapshot/crystal 均被 RESTRICT 拒绝 |
| 15 | a stale worker cannot overwrite the reclaimer after a lease takeover | 租约原子 CAS：旧 worker completeJob 被拒，reclaimer 状态不被覆盖 |
| 16 | concurrent draft saves on one revision admit exactly one writer | revision CAS：两连接并发保存同一 revision，一胜一 CONFLICT |
| 17 | crystal draft promotion fails closed until a human curates every field | 缺任一人工整理字段 → COMPLIANCE_BLOCKED、零 Crystal、零发布记录 |
| 18 | approved-only lookup joins through processedAssetId onto live public products | 诱饵绑定（processedAssetId 不一致）、私有绑定、inactive 产品均不可解析 |
| 19 | publishing binds exactly the selected assets and snapshots the approval decisions | 无关私有预览不阻断发布；publishedAssetKeys 仅含实际绑定资产；9 项审批决策落库 |
| 20 | QC pass stays pending human review: unapproved assets can neither publish nor resolve | worker 夹带权限字段被拒且零写入 → QC 通过落 QC_PENDING + 中性权限 → 公开查询 null → 发布 COMPLIANCE_BLOCKED 且零落库 → 重复审核 CONFLICT → 人工批准后发布成功且公开解析成功 |

### 全量数据库测试（178/178）

在全新空库 `mystcrag_assetdb001_fixr4_test_20260902` 上（本人执行记录，最终轮收尾）：

```
$ createdb mystcrag_assetdb001_fixr4_test_20260902

$ TEST_DATABASE_URL="postgresql://chenyanyan@localhost:5432/mystcrag_assetdb001_fixr4_test_20260902" \
    pnpm --filter @mystcrag/database db:prepare-test
Using existing empty PostgreSQL test database mystcrag_assetdb001_fixr4_test_20260902

$ DATABASE_URL="postgresql://chenyanyan@localhost:5432/mystcrag_assetdb001_fixr4_test_20260902" \
    pnpm --filter @mystcrag/database exec prisma migrate deploy
All migrations have been successfully applied.        # 14 个迁移（资产导入仅 20260831）

$ DATABASE_URL="…" TEST_DATABASE_URL="…" pnpm --filter @mystcrag/database db:test
ℹ tests 178   ℹ pass 178   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0

$ DATABASE_URL="…" pnpm --filter @mystcrag/database db:migrate
No pending migrations to apply.
```

**178 = 106 单元 + 72 集成**（集成含资产导入矩阵 20 场景、persistence 矩阵、seed 与其他 repository 集成）。测试未复用任何已有数据的数据库。

## Repository API（窄接口）

`AssetImportRepository`（经 `packages/database/src/index.ts` 导出）：

- `createSession(input)` — idempotencyKey 幂等
- `registerManifest(sessionId, files)` — manifest fingerprint 幂等 / 冲突
- `recordUploadedFile(fileId, sha256, archiveKey)` — SHA-256 冲突检测 + 会话内去重
- `claimNextJob(workerId, leaseUntil)` — `FOR UPDATE SKIP LOCKED` 原子领取
- `heartbeatJob(jobId, lease, leaseUntil)` — 含 leaseToken 的 CAS 续租
- `completeJob(jobId, result, lease)` / `failJob(jobId, error, retryAt, lease)` — CAS 完成/失败；completeJob 仅接受处理输出与自动 QC 结果
- `reviewProcessedAsset(assetId, decision)` — **数据库层人工审核持久化方法**（无 Contract DTO / HTTP 面，见 Contract 缺口节）
- `saveGroupDraft(groupId, input)` — revision CAS 草稿保存
- `publishGroup(groupId, input)` — 单事务发布（要求存在人工批准的当前资产）
- `findApprovedPublicAsset(assetKey)` — approved-only 公开查询

约束遵守：输入用已验收 Design Contract 的 zod schema 校验；错误统一走既有 `PersistenceError` 体系；无第二套 DTO 或状态机；只存 `storageProvider`/`storageKey`/`archiveKey`，读取时回验 `assetKey === approved:<outputSha256>`，发散即 `DATA_INTEGRITY_ERROR`。

## 发布事务（publishGroup）

`expectedGroupRevision` CAS 校验 → group 状态校验 → 解析既有 `Crystal` 或升级 `CrystalDraft`（人工整理字段门禁，fail closed）→ 创建激活 `MaterialProduct` → 追加 `InventorySnapshot` → 批准选中资产的 `ProductAssetBinding` → 资产复验（**人工批准（APPROVED）**、QC 通过、OWNED/GRANTED、公开展示/商用双许可、内容寻址 assetKey）→ group 置 PUBLISHED、session 推进 checkpoint → 写入 `BeadGroupPublication`（含 payload fingerprint 与 9 项审批决策快照）。任一步失败整体回滚（集成场景 11 证明）。

## pnpm validate / git 检查（最终轮收尾，本人执行）

```
$ pnpm validate
 Tasks:    15 successful, 15 total
Cached:    9 cached, 15 total

$ pnpm --filter @mystcrag/database lint        # prisma validate → valid
$ pnpm --filter @mystcrag/database typecheck   # tsc --noEmit → 0 errors
$ pnpm --filter @mystcrag/database test        # 106/106

$ git diff --check 3bd0361d2a0bf023fa2792ee786cb362b8a175bc..HEAD   # 无输出（零空白错误）
$ git status --short                                                 # 无输出（工作树干净）
$ git rev-parse HEAD   # 8d66120dc533e30d6d7d0e2bf6ac8a3456cdee23
```

## 命令、测试库与结果来源标注

**本人执行记录（本会话，最终轮与补正轮）：**

| 命令 | 测试库 / 对象 | 结果 |
| --- | --- | --- |
| `createdb mystcrag_assetdb001_fixr4_test_20260902` | 全新空库 | 创建成功 |
| `db:prepare-test` | fixr4 | Using existing empty … |
| `prisma migrate deploy` | fixr4 | All migrations applied（14 个） |
| `db:test` | fixr4 | **178/178**，0 skipped |
| `db:migrate` | fixr4 | No pending migrations |
| `pnpm --filter @mystcrag/database test` | — | 106/106 |
| `pnpm --filter @mystcrag/database typecheck` / `lint` | — | 0 errors / valid |
| `pnpm validate` | — | 15/15 |
| `createdb mystcrag_assetdb001_fixr5_test_20260903` | 全新空库（补正轮） | 创建成功 |
| `prisma migrate deploy` | fixr5 | All migrations applied |
| `tsx --test src/repositories/asset-import.repository.integration.test.ts` | fixr5 | **21/21（= 1 顶层 + 20 场景），0 fail / 0 skipped** |
| `ls packages/database/prisma/migrations \| grep -v migration_lock.toml \| wc -l` | 磁盘 | **14** |
| `git diff --stat / --check 3bd0361..HEAD`、`git status --short`、`git rev-parse HEAD` | 仓库 | 8 文件 +6784/−4；零空白错误；工作树干净；HEAD=8d66120 |

**引自前轮交付报告的执行记录（同为执行者记录，非本会话复跑）：** 初版轮 3 库（`mystcrag_assetdb001_{base,final,verify}_test_20260902`，90/90 单元、156/156 全量、14 场景矩阵）与修复轮 3 库（`mystcrag_assetdb001_fixr{1,2,3}_test_20260902`，100/100、171/171、19 场景矩阵），详见当轮报告原文。

**SOL 来源信息（非本人发现/执行，仅注明来源）：** SOL 复审的 8 项 finding（租约 CAS、heartbeat leaseToken、revision CAS、CrystalDraft 晋升门禁、approved-only 查询、发布集合、持久化字段、计数语义）；`20260902` 迁移 P3018/23502 升级失败的判定；QC 与人工批准分离的修复指令；QWEN Contract 补丁任务已取消的决定。本报告未收到、也未引用任何 SOL 独立运行的测试输出；如 SOL 另有独立验证结果，以其自身记录为准。

**隔离测试库残留（供 SOL 复核）：** 本地 PostgreSQL 共留存 `mystcrag_assetdb001_{base,final,verify,fixr1,fixr2,fixr3}_test_20260902` 与 `mystcrag_assetdb001_fixr4_test_20260902`、`mystcrag_assetdb001_fixr5_test_20260903` 十个一次性隔离库（fixr1–fixr3、fixr4 已含当轮运行数据，属正常残留）；均匹配 `^mystcrag_[a-z0-9_]*test[a-z0-9_]*$` 命名规则，未触碰开发库 `mystcrag`。

## TDD 红灯证据（历史记录）

- **初版轮：** 单元测试先于实现编写；以「移走实现文件」方式原样复现红灯（`ERR_MODULE_NOT_FOUND`，54 个用例整体无法加载、36 个既有用例不受影响）——先测后实现的直接证据（详见初版报告原文）。
- **修复轮：** 以 `git checkout HEAD -- asset-import.repository.ts` 临时回退实现后复现 12 项红灯（`tests 100 / pass 88 / fail 12`），恢复后 100/100 绿（详见 `task-2-sol-fix-report.md`）。
- **最终轮：** 先改单元测试后实现：实现前运行即连锁红灯（`asset job completion result failed validation: usagePermission …` 等 VALIDATION_ERROR，106 项中多项红；`reviewProcessedAsset` 实现前方法缺失即红）；实现后 106/106 绿。

## 已知风险与工程注记

1. **时间戳全部绑定参数、不用服务器 `now()`：** `TIMESTAMP(3)` 无时区而 pg adapter 以 UTC 序列化绑定日期；claim/heartbeat/complete/fail 的全部时间为绑定参数，避免会话时区（Asia/Shanghai）导致租约/重试比较偏移 8 小时。
2. **批准绑定唯一索引为 `(material_product_id, purpose) WHERE binding_status='APPROVED'`：** 支持一产品同时持有一个 TEXTURE 与一个 MODEL 批准绑定的最小表达；Prisma 无法表达部分唯一索引，migration SQL 手写并由场景 10/13 证明。
3. **集成测试必须全新空库：** 在已跑过全量套件的库上单独重跑矩阵会因残留同名 Crystal 失败（既有测试约定下的环境污染，非产品缺陷）；SOL 复核请务必用全新空库。
4. **`persistence.integration.test.ts` 单行伴随变更**超出白名单（净 1 行，原因见「白名单偏差声明」），请 SOL 裁定接受与否。
5. **`findApprovedPublicAsset` 为任务清单之外的附加读方法：** 实现「approved-only 查询」要求的最小必要入口，未引入第二套状态机。
6. **repository 体量（1797 行）：** 单文件围绕同一导入生命周期；未拆分是为避免提前抽象（可按 SOL 意见在后续任务中拆分）。

## 停止点

任务完成并已提交（最终 `8d66120`）。按规程**停止于此**，等待 SOL 审核；未 merge、未建 PR、未 push、未开始 Task 3、未触碰 design-contract / 前端 / Backend / 用户珠子原图。待 SOL 裁定事项：（1）`persistence.integration.test.ts` 净 1 行伴随变更的接受与否；（2）两个人工 API Contract 缺口（人工审核 API、CrystalDraft 完善 API）在 QWEN 补丁任务已取消后的后续处置路径。
