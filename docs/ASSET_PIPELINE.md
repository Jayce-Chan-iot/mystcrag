# Asset Pipeline & Asset Worker

TASK-ASSET-WORKER-001 的模块接口、存储布局、配置与交付记录。本文件是该任务的持久进度记录与操作文档;历史红灯记录与命令输出只引用真实执行结果,不虚构。

## 1. 任务状态快照

| 项 | 值 |
| --- | --- |
| 任务 | `TASK-ASSET-WORKER-001`(GLM,`task/asset-worker-001-local-pipeline`) |
| 任务起始 SHA | `f17fa2e45b2507b433846d6655d3763ee1cbf087` |
| 数据库实现祖先 | `8d66120dc533e30d6d7d0e2bf6ac8a3456cdee23`(TASK-ASSET-DB-001,已验收) |
| Pipeline 完成快照 | `6dcd2db24ca0ee37b700c803b68d6c6f1d6c355e` |
| 当前状态 | REVIEW:Worker、真库联调、完整门禁已交付(§8) |

## 2. 模块与接口

### 2.1 `packages/asset-pipeline`(已完成)

| 模块 | 关键导出 |
| --- | --- |
| `content-type.ts` | `detectAssetSourceKind(bytes): DetectedAssetSourceKind \| null`(魔数检测:ARW/JPEG/PNG/WEBP) |
| `hash.ts` | `sha256OfBytes`, `sha256OfFile`, `FileDigest` |
| `pairing.ts` | `pairRawAndJpeg(files): PairingOutcome`(跨目录同 stem RAW/JPG 配对) |
| `storage.ts` | `ArchiveStore`(`putOriginal`/`putProcessed`/`putStaging`/`removeStaging`/`read`/`verifiedRead`/`listSessionFiles`,原子 link+unlink、防符号链接越界、同 key 不同内容拒绝;仅 staging 可删除,raw/processed 不可变) |
| `grouping.ts` | `computeDHash`, `computeColorHistogram`, `hammingDistance`, `histogramDistance`, `suggestGroups`, `GROUPING_THRESHOLDS` |
| `image-processor.ts` | `processBeadImage`(保真扣图,512/256 透明 WebP,`PROCESSOR_VERSION = "faithful-v1"`,不放大主体) |
| `quality.ts` | `runQualityChecks`(11 项数值 QC,失败不静默通过) |

### 2.2 `apps/asset-worker`(本阶段交付)

- `src/index.ts`:运行入口。读取 `DATABASE_URL`、`MYSTCRAG_ASSET_ARCHIVE_ROOT`、`MYSTCRAG_ASSET_WORKER_ID`,装配 `createPrismaClient` + `AssetImportRepository` + `ArchiveStore.fromEnvironment`,启动 `AssetWorker`。档案根缺失或在 Git worktree 内时拒绝启动(fail-closed)。
- `src/jobs.ts`:内部 job payload 契约(Zod 严格校验 `ClaimedAssetJob.payload: unknown` 后消费)与三类任务处理器。
- `src/runtime.ts`:租约驱动主循环(领取、心跳续租、完成/失败提交、有限重试、SIGTERM 优雅退出)。

## 3. 存储布局(单一 `ArchiveStore` 适配器)

```text
<MYSTCRAG_ASSET_ARCHIVE_ROOT>/          # 必须在所有 Git worktree 之外
  imports/<session-id>/raw/<sha256>.<ext>                              # 不可变原片
  imports/<session-id>/staging/<uuid>                                  # 上传暂存(归档成功后删除)
  imports/<session-id>/processed/<group-id>/v<n>/bead-512.webp         # 主图
  imports/<session-id>/processed/<group-id>/v<n>/thumb-256.webp        # 缩略图
  imports/<session-id>/tmp/…                                           # 原子写入中转,非业务 key
```

所有写入经临时文件 + fsync + 回读校验(大小与 SHA-256)后原子 link;已存在 key 仅当内容哈希一致时复用,同 key 不同内容直接拒绝,源文件只读。

## 4. 配置

| 环境变量 | 作用 | 缺省 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串 | 必填 |
| `MYSTCRAG_ASSET_ARCHIVE_ROOT` | 档案根目录,必须在 Git worktree 之外 | 必填,缺失拒绝启动 |
| `MYSTCRAG_ASSET_WORKER_ID` | Worker 标识(≤160 字符) | `asset-worker-<pid>` |
| `MYSTCRAG_ASSET_WORKER_LEASE_MS` | 租约时长 | `60000` |
| `MYSTCRAG_ASSET_WORKER_HEARTBEAT_MS` | 心跳间隔 | `20000` |
| `MYSTCRAG_ASSET_WORKER_POLL_MS` | 空闲轮询间隔 | `5000` |
| `MYSTCRAG_ASSET_WORKER_SHUTDOWN_GRACE_MS` | SIGTERM 后等待当前任务完成的宽限 | `30000` |
| `MYSTCRAG_ASSET_WORKER_TRANSIENT_RETRY_DELAY_MS` | 瞬态失败的退避重试间隔 | `60000` |

## 5. Job 契约与数据流

`ClaimedAssetJob.payload` 为 `unknown`,Worker 用 Zod 严格校验后才消费。payload 是内部处理输入,与公开 HTTP DTO 分离;由后续后台导入 API(TASK-ASSET-BE-001)在创建任务时组装,本任务的联调测试以 fixture 模拟该组装。

### 5.1 ARCHIVE_FILE

```jsonc
{ "fileId": "<asset_source_files.id>", "stagingKey": "imports/<session>/staging/<uuid>", "sha256": "<64-hex>" }
```

流程:从 staging 读字节并校验 SHA-256 → 魔数检测 → `putOriginal` → `recordUploadedFile`(业务写入:ARCHIVED/SKIPPED_DUPLICATE + session 计数)→ 删除 staging → `completeJob({ kind, sha256, archiveKey, storageProvider: "local-fs" })`。

### 5.2 GROUP_SESSION

```jsonc
{ "files": [{ "fileId", "clientFileId", "relativePath", "sha256", "archiveKey", "byteSize", "lastModifiedMs", "kind" }] }
```

流程:逐个 `verifiedRead` 原片 → dHash + 颜色直方图 → `suggestGroups`(保守阈值)→ `completeJob({ kind, groups: [...] })`,groups 含成员、建议主图与相似度证据。

### 5.3 PROCESS_GROUP

```jsonc
{ "groupId": "<group>", "processingVersion": 1, "files": [{ "fileId", "archiveKey", "sha256" }] }
```

流程:取组内已归档源图(优先非 ARW)→ `processBeadImage` → `putProcessed`(主图+缩略图)→ `runQualityChecks` → `completeJob({ kind, processingVersion, output, qc })`。仓储在该事务内创建 `processed_assets` 行:QC 通过仅 `QC_PENDING`,usage 权限全部中性,绝不自动 APPROVE/发布。

## 6. 租约、恢复与幂等语义

- 领取:`claimNextJob` 使用 `FOR UPDATE SKIP LOCKED`,两个 Worker 不会领到同一行;RUNNING 且租约过期的任务可被重领(崩溃 Worker 不阻塞队列)。
- 隔离:每次领取生成新 `leaseToken`;心跳、完成、失败全部经 `jobId + RUNNING + workerId + leaseToken + 未过期` 的条件更新(Compare-And-Set),过期租约的提交整体回滚并抛 `CONFLICT`。
- 心跳:处理期间按间隔续租;心跳失败(返回 false 或抛错)立即停止处理并放弃该任务,不提交任何结果。
- SIGTERM:停止领取新任务,等待当前任务完成或超过宽限;超时直接退出,租约到期后由其他 Worker 重领,不无限持有未过期租约。
- 重试:`failJob` 递增 `retryCount`,超过 `maxRetries` 转 `FAILED`;瞬态错误(存储读写失败)带退避 `retryAt`,确定性错误(payload 无效、解码失败、主体缺失)不重试风暴。重试任务重新领取时 `putProcessed` 对同 key 同哈希输出幂等复用,不产生重复内容。
- 权限边界:Worker 只上报输出与 QC;不调用 `reviewProcessedAsset`、`publishGroup`,不写使用权限/公开 key/APPROVED。

## 7. 接口缺口(预检结论,报告 SOL,不在本任务内补洞)

| 编号 | 缺口 | 处置 |
| --- | --- | --- |
| G1 | `@mystcrag/database` 无公开方法读取 session/group 的源文件清单(含 `archiveKey`/`sha256`/`groupId`) | Worker payload 契约承载输入(§5),由 Task 4 后台组装;文档已说明组装责任 |
| G2 | `completeJob(GROUP_SESSION)` 仅记录 result,不写 `bead_image_groups`/`asset_source_files.group_id` | 设计如此:分组建议作为证据供人工审核流程消费;Worker 不覆盖人工分组 |
| G3 | 无公开任务创建方法(`asset_processing_jobs` 行) | Task 4 职责;本任务联调测试用 Prisma fixture 代行创建,仅测试支撑,运行时无直连 |
| G4 | `completeJob(PROCESS_GROUP)` 的 result 仅接受单个 output | 主图(MAIN)上报建 `processed_assets` 行;缩略图落盘为 `thumb-256.webp` 但不上报,待后续扩展点 |

## 8. 进度检查点

### 2026-09-03 恢复(基线 `6dcd2db`)

- 已实现:`packages/asset-pipeline` 全部模块与测试。
- SOL 验证(引用,非本人执行):`pnpm --filter @mystcrag/asset-pipeline lint`/`typecheck` 通过;`test` 62/62 通过,0 fail 0 skipped;`git diff --check f17fa2e..HEAD` 通过。
- 仓储预检完成(§5–§7);`apps/asset-worker`、根配置接线、真库联调、完整门禁未完成。

### 2026-09-03 交付(Worker + 真库联调 + 完整门禁)

新增/变更:

- `packages/asset-pipeline/src/storage.ts`:`putStaging`(会话暂存,UUID key)+ `removeStaging`(幂等,仅 staging key 可删)+ 对应测试。
- `apps/asset-worker`(新包):`src/jobs.ts`(payload 契约 + 三类处理器 + `createJobHandlers`)、`src/runtime.ts`(`AssetWorker` 租约循环)、`src/index.ts`(入口,SIGTERM 优雅退出)、`tsconfig.json`、`package.json`;测试 `jobs.test.ts`、`runtime.test.ts`、`worker.integration.test.ts`。
- 根配置接线:`turbo.json`(`@mystcrag/asset-worker#dev` 环境透传)、`.env.example`(§4 全部变量)、`pnpm-lock.yaml`(`pnpm install --no-frozen-lockfile` 更新,新增 `sharp`/`tsx` 等已锁定依赖)。`pnpm-workspace.yaml` 无需改动(`apps/*` 已覆盖)。

本阶段真实执行记录(全部为实际执行,退出码 0):

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @mystcrag/asset-pipeline lint` / `typecheck` | 通过(`prisma validate` 不涉及;`tsc --noEmit` 通过) |
| `pnpm --filter @mystcrag/asset-pipeline test` | 64/64 通过(0 fail,0 skipped;原 62 + staging 2) |
| `pnpm --filter @mystcrag/asset-worker lint` / `typecheck` / `build`(`tsc --noEmit`) | 通过 |
| `pnpm --filter @mystcrag/asset-worker test`(单元,无库) | 18 通过 + 1 skipped(集成测试,未设 `DATABASE_URL`/`MYSTCRAG_ASSET_ARCHIVE_ROOT` 时跳过) |
| `pnpm --filter @mystcrag/asset-worker test`(真库联调) | 26/26 通过,0 fail,0 skipped;集成子测试 7/7:ARCHIVE_FILE 归档落库、同会话去重(`SKIPPED_DUPLICATE`/`duplicateOfId`/计数)、GROUP_SESSION 证据不写业务表、PROCESS_GROUP `QC_PENDING`+缩略图落盘、租约过期重领与新旧 `leaseToken` 隔离(旧持有者心跳 false、complete `CONFLICT`)、重试链(确定性失败退避重排,超 `maxRetries` 转 `FAILED`,`errorCode=PAYLOAD_INVALID`)、崩溃恢复(输出幂等复用,恰好一个 `isCurrentVersion`) |
| `pnpm db:test` | 178/178 通过(0 fail,0 skipped);库 `mystcrag_assetworker001_dbtest_20260903`(全新空库,migrate 后执行) |
| `pnpm validate` | 通过;turbo 17 任务成功(15 缓存命中,2 实际执行:`@mystcrag/asset-pipeline:build`、`@mystcrag/asset-worker:build`),含根 `tests/*.test.mjs` |
| `git diff --check f17fa2e..HEAD`(已提交部分)与工作区 | 均通过 |

联调测试库(真实创建,均未承载业务数据):

- 集成测试:`mystcrag_assetworker001_test_20260903`(migrate 后承载联调用例,幂等键含时间戳前缀,可重复运行)
- `pnpm db:test`:`mystcrag_assetworker001_dbtest_20260903`(全新空库)

合成测试素材:全部图像由 SVG→sharp PNG 合成(800×800 珠子场景),未处理任何桌面照片。

## 9. 操作

```bash
# 联调:空测试库(从未承载业务数据)+ 迁移
psql -h localhost -U mystcrag -d postgres \
  -c 'CREATE DATABASE "mystcrag_assetworker001_test_20260903" OWNER "mystcrag";'
DATABASE_URL="postgresql://mystcrag:mystcrag_dev@localhost:5432/mystcrag_assetworker001_test_20260903?schema=public" \
  pnpm --filter @mystcrag/database db:migrate

DATABASE_URL="postgresql://mystcrag:mystcrag_dev@localhost:5432/mystcrag_assetworker001_test_20260903?schema=public" \
  MYSTCRAG_ASSET_ARCHIVE_ROOT="$(mktemp -d)" \
  pnpm --filter @mystcrag/asset-worker test

# 运行(档案根必须在 Git worktree 之外,缺失或越界拒绝启动)
DATABASE_URL=… MYSTCRAG_ASSET_ARCHIVE_ROOT=/archive/outside-repo \
  pnpm --filter @mystcrag/asset-worker start
```

任务来源与验收:见 `docs/superpowers/plans/2026-09-03-asset-worker-parallel-dispatch.md` 与 `docs/superpowers/plans/2026-08-31-bead-asset-import-assistant-implementation-plan.md` Task 3。
