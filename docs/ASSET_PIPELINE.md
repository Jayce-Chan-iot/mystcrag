# Asset Pipeline & Asset Worker

TASK-ASSET-WORKER-001 的模块接口、存储布局、配置与交付记录。本文件是该任务的持久进度记录与操作文档;历史红灯记录与命令输出只引用真实执行结果,不虚构。

## 1. 任务状态快照

| 项 | 值 |
| --- | --- |
| 任务 | `TASK-ASSET-WORKER-001`(GLM,`task/asset-worker-001-local-pipeline`) |
| 任务起始 SHA | `f17fa2e45b2507b433846d6655d3763ee1cbf087` |
| 数据库实现祖先 | `8d66120dc533e30d6d7d0e2bf6ac8a3456cdee23`(TASK-ASSET-DB-001,已验收) |
| Pipeline 完成快照 | `6dcd2db24ca0ee37b700c803b68d6c6f1d6c355e` |
| 首轮交付 SHA | `f28db19e4919984d593ba2381eeb739dae43f089` |
| SOL 修复提交 | `见 §10.3`(基于 `f28db19`) |
| 当前状态 | REVIEW:SOL 验收 5 项问题已修复(§10.3) |

## 2. 模块与接口

### 2.1 `packages/asset-pipeline`(已完成)

| 模块 | 关键导出 |
| --- | --- |
| `content-type.ts` | `detectAssetSourceKind(bytes): DetectedAssetSourceKind \| null`(魔数检测:ARW/JPEG/PNG/WEBP)。ARW 不是 4 字节 TIFF 头即判:需完整 TIFF 结构(大小端魔数、IFD 偏移与条目边界、Make 标签为 SONY),裸 TIFF 头、普通 TIFF、其他厂商、截断或损坏文件均拒绝 |
| `hash.ts` | `sha256OfBytes`, `sha256OfFile`, `FileDigest` |
| `pairing.ts` | `pairRawAndJpeg(files): PairingOutcome`(跨目录同 stem RAW/JPG 配对) |
| `storage.ts` | `ArchiveStore`(`putOriginal`/`putProcessed`/`putStaging`/`removeStaging`/`read`/`verifiedRead`/`listSessionFiles`,原子 link+unlink、防符号链接越界、同 key 不同内容拒绝;仅 staging 可删除,raw/processed 不可变) |
| `grouping.ts` | `computeDHash`, `computeColorHistogram`, `hammingDistance`, `histogramDistance`, `suggestGroups`, `GROUPING_THRESHOLDS`。候选必须携带 `kind`;同 stem 强配对仅限互补的 ARW+JPEG,两张 JPEG/PNG/WebP 同 stem 不得仅凭文件名高置信度合并 |
| `image-processor.ts` | `processBeadImage`(保真扣图,512/256 透明 WebP,`PROCESSOR_VERSION = "faithful-v1"`,不放大主体) |
| `quality.ts` | `runQualityChecks`(11 项数值 QC,失败不静默通过) |

### 2.2 `apps/asset-worker`(本阶段交付)

- `src/repository-roots.ts`:Git worktree 根发现。优先 `git worktree list --porcelain`(以模块目录为 cwd,5 s 超时),得到当前 worktree、主 checkout 与所有已注册兄弟 worktree;git 不可用或命令失败时回退文件系统走查(向上找 `.git` 目录,或解析 linked-worktree `.git` 文件的 `gitdir:` 指针推导主 checkout)。两条路径都无法识别仓库时抛 `RepositoryRootsError` 拒绝启动(无法证明档案根安全即不启动)。所有根经 realpath 归一,prunable/不存在的条目被过滤。
- `src/index.ts`:运行入口。读取 `DATABASE_URL`、`MYSTCRAG_ASSET_ARCHIVE_ROOT`、`MYSTCRAG_ASSET_WORKER_ID`,用 `discoverRepositoryRoots` 得到保护根集合后装配 `createPrismaClient` + `AssetImportRepository` + `ArchiveStore.fromEnvironment`,启动 `AssetWorker`。档案根缺失、或经 realpath 后位于任一已发现 Git worktree 内部(含符号链接指向)时拒绝启动。
- `src/jobs.ts`:内部 job payload 契约(Zod 严格校验 `ClaimedAssetJob.payload: unknown` 后消费)、跨会话/跨分组隔离校验(§5.4)与三类任务处理器。
- `src/runtime.ts`:租约驱动主循环(领取、心跳续租、完成/失败提交、有限重试、SIGTERM 优雅退出);清理动作只作为 `afterCommit` 钩子在完成提交成功后执行。

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

流程:payload 校验(staging key 严格为 `imports/<job.sessionId>/staging/<uuid>`,§5.4)→ 从 staging 读字节并校验 SHA-256 → 魔数检测 → `putOriginal` → `recordUploadedFile`(业务写入:ARCHIVED/SKIPPED_DUPLICATE + session 计数)→ `completeJob({ kind, sha256, archiveKey, storageProvider: "local-fs" })` → **提交成功后**才执行 `removeStaging`(`afterCommit` 钩子)。

staging 清理与恢复顺序(§6):删除只发生在完成提交成功之后;提交被拒(租约冲突或其他错误)不删除;清理失败只记录错误并留下可回收的 staging 条目,不把已完成的任务改回失败。

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

### 5.4 payload 会话与分组隔离(先于任何存储访问)

所有校验在读取任何文件或写入任何输出之前执行,失败抛不可重试的 `PAYLOAD_INVALID`:

- ARCHIVE_FILE:`stagingKey` 必须严格匹配 `^imports/<sessionId>/staging/<uuid4>$`,且 `<sessionId>` 必须等于 `job.sessionId`(语法不符或属于其他会话均拒绝)。
- GROUP_SESSION:每个 `files[i].archiveKey` 必须严格匹配 `^imports/<sessionId>/raw/<64-hex>.(arw|jpeg|jpg|png|webp)$` 且 sessionId 等于 `job.sessionId`;逐条校验,不只检查首条。
- PROCESS_GROUP:先校验 `payload.groupId === job.groupId`(防止输出写入错误 group 路径),再逐条校验每个 `files[i].archiveKey` 的语法与 session 归属。
- 任何跨会话文件都无法进入 GROUP_SESSION/PROCESS_GROUP 的读取或输出路径。

`fileId` 与 `job.sessionId` 的归属一致性是已知接口缺口 G5(§7),由 Task 4 在组装 payload 时保证。

## 6. 租约、恢复与幂等语义

- 领取:`claimNextJob` 使用 `FOR UPDATE SKIP LOCKED`,两个 Worker 不会领到同一行;RUNNING 且租约过期的任务可被重领(崩溃 Worker 不阻塞队列)。
- 隔离:每次领取生成新 `leaseToken`;心跳、完成、失败全部经 `jobId + RUNNING + workerId + leaseToken + 未过期` 的条件更新(Compare-And-Set),过期租约的提交整体回滚并抛 `CONFLICT`。
- 心跳:处理期间按间隔续租;心跳失败(返回 false 或抛错)立即停止处理并放弃该任务,不提交任何结果。
- 崩溃窗口(ARCHIVE_FILE):staging 删除只作为 `afterCommit` 钩子在 `completeJob` 成功提交之后执行。归档落盘后、提交前崩溃时 staging 保留,重领任务用同一 staging 恢复为 COMPLETED(`putOriginal` 幂等复用已归档原片,`recordUploadedFile` 对已 ARCHIVED 同哈希行为幂等,session 计数不重复)。`completeJob` 因非租约原因被拒时记 `COMPLETION_REJECTED`(可重试)重新入队,staging 同样保留。租约被新 token 接管后,旧持有者提交得 `CONFLICT` 且不执行清理;清理失败仅记录错误,不把已完成任务改回失败(最多遗留可回收的 staging 条目)。
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
| G5 | `@mystcrag/database` 公开 API 无法证明 payload 中的 `fileId` 属于 `job.sessionId`(`recordUploadedFile` 只接受 fileId;无按 session 过滤的文件查询)。Worker 已拒绝所有跨会话的 archiveKey/stagingKey(§5.4),但 `fileId` 的归属只能由组装方保证 | **未完全解决,登记为缺口**。Task 4 组装 payload 时必须只放入该 session 名下的 fileId(经 G1 的清单查询或创建时上下文);建议后续为 `recordUploadedFile`/`completeJob` 增加 `file.sessionId === job.sessionId` 的服务端校验(需数据库任务承接,本任务不得改库) |

## 8. 分组与 QC 阈值及依据

### 8.1 分组阈值(`GROUPING_THRESHOLDS`,`grouping.ts`)

| 阈值 | 值 | 依据 |
| --- | --- | --- |
| `dHashConfident` | 6/64 bit | 64 位 dHash 中 6 位以内差异视为近乎同帧(编码噪声级别) |
| `dHashReview` | 14/64 bit | 14 位以内允许轻微主体移动,进低置信度人工复核,绝不自动合并 |
| `histogramConfident` | 0.15(L1) | 颜色分布近乎一致的 64 bin 直方图 L1 距离上限 |
| `histogramReview` | 0.35(L1) | 复核上限,超过即不视为相似 |
| `captureGapConfidentMs` | 60 000 ms | 连拍窗口:同一珠子的连续拍摄通常在 1 分钟内 |

高置信度合并要求视觉信号与拍摄时间**同时**满足;只有单项满足的进入低置信度复核建议。同 stem 强配对仅限互补的 ARW+JPEG(原始+机内 JPEG);两张 JPEG/PNG/WebP 即使同名也不凭文件名合并,必须走上述视觉+时间阈值。

### 8.2 QC 阈值(`QC_THRESHOLDS`,`quality.ts`)

| 检查 | 阈值 | 依据 |
| --- | --- | --- |
| 主体锐度 | `minBlurScore: 15` | 低于下限判定失焦;建议重拍而非算法合成细节 |
| 有效分辨率 | `minSubjectEdgePx: 410` | 主体有效边缘至少约 410px,防止小图放大 |
| 主体占比 | 0.35–0.95 画布 | 过小=构图问题,过大=可能裁切 |
| 内部空洞 | `maxHoleRatio: 0.05` | 扣图后主体内部透明洞占比上限(反光误判) |
| 边缘光晕 | `maxHaloFraction: 0.5` | 半透明边缘占比上限 |
| 边缘锯齿 | `maxHardEdgeFraction: 0.1` | 硬边占比上限(抗锯齿失败) |
| 色差 | `maxColorDelta: 16` | 输出与源图主体色彩偏差上限 |
| 主图体积 | `maxMainBytes: 1 572 864`(1.5 MiB) | 512 WebP 主图体积上限 |
| 缩略图体积 | `maxThumbBytes: 393 216`(384 KiB) | 256 WebP 缩略图体积上限 |

QC 失败不删除输出、不静默通过:逐项记录证据并给出整体判定,交人工审核门禁消费;QC 通过仍需人工 APPROVE 才能发布。

## 9. 备份与恢复要求

- **原片唯一性**:档案根是原片的唯一持久存储;raw/processed key 不可变、不可覆盖(同 key 不同内容直接拒绝),原片无法从数据库重建。
- **备份要求**:`MYSTCRAG_ASSET_ARCHIVE_ROOT` 指向的目录必须纳入独立于 Git 的备份策略(§2.2 的 worktree 防护保证原片不会进入 Git 历史);数据库按常规 PostgreSQL 备份。原片与数据库应保持备份点接近(数据库行引用档案 key)。
- **崩溃恢复**:任一 Worker 崩溃后,其任务由租约过期+重领自动恢复,无需人工干预(§6)。恢复的输入(staging)只在完成提交成功后才删除,崩溃最多遗留可回收的 staging 条目。
- **staging 遗留清理**:清理失败或崩溃遗留的 staging 条目仅占用空间、不影响恢复;可通过 `ArchiveStore.removeStaging`(幂等,仅接受 staging key)清理。
- **一致性暴露路径**:若档案文件丢失而数据库行存在,重试或下游 `verifiedRead`/复用校验会以 `HASH_MISMATCH`/`READ_FAILED` 暴露,不会静默用其他内容顶替。

## 10. 进度检查点

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

### 2026-09-04 SOL 验收修复(基线 `f28db19`,分支 `task/asset-worker-001-local-pipeline`,worktree `.worktrees/asset-worker-001`)

SOL 验收提出 5 项问题,全部以"先补失败测试、再修复"处理;任务保持 REVIEW,未推送、未合并、未开始 Task 4。

修复项与对应测试:

| # | 问题 | 修复 | 测试 |
| --- | --- | --- | --- |
| P1-1 | 档案根防护失效:`resolve(dirname(import.meta.url), "../..")` 实际得到 `<worktree>/apps`,`<worktree>/archive`、`packages/**` 等仓库内目录仍会被接受 | 新增 `src/repository-roots.ts`(§2.2):`git worktree list --porcelain` 发现全部 worktree,git 不可用回退文件系统走查(`.git` 目录 / linked-worktree `gitdir:` 指针推导主 checkout),均无法识别时 `RepositoryRootsError` 拒绝启动;`index.ts` 接入;`ArchiveStore` 继续对每个根做 realpath 前缀比对 | `tests/archive-root-guard.test.ts`(8 项):当前 worktree 根、`worktree/packages` 下目录、主 checkout 内目录、指向 worktree/主 checkout 的符号链接全部拒绝;仓库外目录通过;`.git` 文件指针解析、`.git` 目录解析、无 git 且无 `.git` 时 fail-closed、prunable 条目过滤 |
| P1-2 | ARCHIVE_FILE 不可恢复的崩溃窗口:`putOriginal → recordUploadedFile → removeStaging → completeJob`,删除 staging 后崩溃即得 `STAGING_UNAVAILABLE`,无法恢复 COMPLETED | staging 删除移入 `afterCommit` 钩子,仅当 `completeJob` 成功提交后执行;提交被拒(租约冲突 `CONFLICT` 或非租约原因 `COMPLETION_REJECTED`)一律不清理;清理失败仅记录错误,任务保持 COMPLETED | 单元:`jobs.test.ts`(staging 保留至提交、`recordUploadedFile` 失败保留 staging、重领重试复用原片且仅一份 raw)、`runtime.test.ts`(`afterCommit` 严格在 `completeJob` 之后、租约丢失跳过清理、清理失败不改结果);真库:`worker.integration.test.ts` 4 个新子测试(§10.3 验证记录) |
| P1-3 | payload 会话/分组隔离不足:staging key 无严格结构校验、GROUP_SESSION 只查部分 key、PROCESS_GROUP 不校验 groupId | `STAGING_KEY_PATTERN`/`RAW_KEY_PATTERN` 严格语法 + sessionId 一致性;GROUP_SESSION/PROCESS_GROUP 逐条校验 archiveKey;PROCESS_GROUP 校验 `payload.groupId === job.groupId`;全部在任何存储读取/输出写入之前(§5.4) | `tests/payload-isolation.test.ts`:恶意 payload(staging/raw 语法混淆、跨会话 key、groupId 不匹配、后续条目跨会话)在 refusing store 上证明被拒于存储访问之前;`fileId` 归属登记为缺口 G5 |
| P2-4 | 同 stem 分组错误扩大到任意图片类型 | `GroupingCandidate` 保留 `kind` 并在入口校验;stem 强配对仅限互补 ARW+JPEG | `grouping.test.ts`:同 stem 双 JPEG(跨目录、内容不同)不合并;跨目录同 stem PNG+WebP 不凭文件名合并 |
| P2-5 | 任意 4 字节 TIFF 头都被当成 ARW | `isSonyArw`:大小端魔数、IFD 偏移与条目边界、Make 标签(SONY)结构校验;截断、普通 TIFF、其他厂商、伪造头拒绝,保留真实 ARW 大小端兼容 | `content-type.test.ts`(裸头/普通 TIFF/CANON/截断/损坏魔数/大小端 SONY 通过)与 `image-processor.test.ts`(`syntheticSonyArw` 最小合成 fixture 替换原裸 TIFF 头素材) |

红灯证据(实际执行):

- `tests/archive-root-guard.test.ts` 首跑(实现前):`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../apps/asset-worker/src/repository-roots.js'`,`fail 1`(fail 30/pass,模块缺失即功能缺失)。
- 真库接管子测试首跑 typecheck(实现前):`tests/worker.integration.test.ts(641,78): error TS2554: Expected 1 arguments, but got 2`(`processClaimedJobForTest` 尚无 `submit` 参数)。
- payload 隔离、分组 kind、ARW 结构校验同样红-first:测试先于实现编写(名称见上表),实现前相应断言不可通过。

依赖与素材检查(实际执行):

- `grep -rn "fetch(\|axios\|http.request\|https.request\|node:http\|undici" packages/asset-pipeline/src apps/asset-worker/src` → 无匹配,无网络依赖。
- 运行时依赖:asset-pipeline = `@mystcrag/design-contract, sharp, zod`;asset-worker = `@mystcrag/asset-pipeline, @mystcrag/database, @mystcrag/design-contract, zod`(dev: `sharp, tsx, typescript, @types/node`)。无生成式/AI 图像库;sharp 仅做确定性光栅处理。
- 变更集无任何图片/二进制文件(`git status --porcelain` 无 `*.png|jpg|jpeg|arw|webp|tif|tiff|heic`);所有 fixture 为 SVG→sharp PNG 或 `buildTiff`/`syntheticSonyArw` 最小合成字节,无用户照片,无原片提交。

真库环境与测试库(真实创建,均全新空库,migrate 后执行):

- PostgreSQL 17.10(Homebrew,aarch64-apple-darwin25.4.0);`packages/database/prisma/migrations` 共 14 个迁移(至 `20260831_add_bead_asset_import`)。
- Worker 联调:`mystcrag_assetworker001_fix_test_20260904`
- `pnpm db:test`:`mystcrag_assetworker001_fix_dbtest_20260904`

本阶段真实执行记录(全部实际执行):

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @mystcrag/asset-pipeline lint` / `typecheck` / `test` | 通过;测试 70/70(0 fail,0 skipped) |
| `pnpm --filter @mystcrag/asset-worker lint` / `typecheck` | 通过(`tsc --noEmit`) |
| `pnpm --filter @mystcrag/asset-worker test`(单元,无库环境) | 38 通过 + 1 skipped(集成测试环境门控),0 fail |
| `pnpm --filter @mystcrag/asset-worker test`(真库联调 `mystcrag_assetworker001_final_test_20260904`) | 50/50 通过,0 fail,0 skipped(单元层 38,含入口防护 8;集成子测试 12,含 4 个崩溃窗口新子测试:归档落盘后/completeJob 前崩溃→staging 保留→重领 COMPLETED 且原片与 session 计数不重复;completeJob 被拒→`COMPLETION_REJECTED` 重排→重试 COMPLETED;租约被新 token 接管→旧持有者 complete `CONFLICT` 且不删 staging→新持有者完成;清理失败→任务保持 COMPLETED、staging 可回收) |
| `pnpm db:test` | 178/178 通过(0 fail,0 skipped);库 `mystcrag_assetworker001_final_dbtest_20260904`(全新空库) |
| `pnpm validate` | 通过;turbo 17/17 任务成功(15 缓存命中,2 实际执行;本任务触及的 asset-pipeline/asset-worker build 因源码变更重执行) |
| `git diff --check f17fa2e..HEAD` / `git status --short --branch` | 通过(提交后确认) |

逐文件 diffstat(`f28db19` → `1fbfcdc`,含新增文件):

```text
 apps/asset-worker/src/index.ts                     |  16 +-
 apps/asset-worker/src/jobs.ts                      | 107 ++++++++--
 apps/asset-worker/src/repository-roots.ts          | 134 +++++++++ (新增)
 apps/asset-worker/src/runtime.ts                   |  36 +++-
 apps/asset-worker/tests/archive-root-guard.test.ts | 252 +++++++++++ (新增)
 apps/asset-worker/tests/jobs.test.ts               | 122 ++++++++++-
 apps/asset-worker/tests/payload-isolation.test.ts  | 213 +++++++++ (新增)
 apps/asset-worker/tests/runtime.test.ts            |  90 ++++++-
 apps/asset-worker/tests/worker.integration.test.ts | 234 ++++++++++++++++++++-
 docs/ASSET_PIPELINE.md                             |  本节
 docs/tasks/TASK_REGISTRY.md                        |   2 +-
 packages/asset-pipeline/src/content-type.ts        |  66 +++++-
 packages/asset-pipeline/src/grouping.ts            |  16 +-
 packages/asset-pipeline/tests/content-type.test.ts | 107 ++++++++++-
 packages/asset-pipeline/tests/grouping.test.ts     |  65 +++++-
 packages/asset-pipeline/tests/image-processor.test.ts |  25 ++-
```

## 11. 操作

```bash
# 联调:全新空测试库 + 迁移(示例为本机 Homebrew PostgreSQL,trust 认证)
psql -h localhost -U chenyanyan -d postgres \
  -c 'CREATE DATABASE "mystcrag_assetworker001_fix_test_20260904" OWNER "chenyanyan";'
DATABASE_URL="postgresql://chenyanyan@localhost:5432/mystcrag_assetworker001_fix_test_20260904" \
  pnpm --filter @mystcrag/database db:migrate

DATABASE_URL="postgresql://chenyanyan@localhost:5432/mystcrag_assetworker001_fix_test_20260904" \
  MYSTCRAG_ASSET_ARCHIVE_ROOT="$(mktemp -d)" \
  pnpm --filter @mystcrag/asset-worker test

# 运行(档案根经 realpath 后不得位于任何已发现的 Git worktree 内;发现失败或越界拒绝启动)
DATABASE_URL=… MYSTCRAG_ASSET_ARCHIVE_ROOT=/archive/outside-repo \
  pnpm --filter @mystcrag/asset-worker start
```

任务来源与验收:见 `docs/superpowers/plans/2026-09-03-asset-worker-parallel-dispatch.md` 与 `docs/superpowers/plans/2026-08-31-bead-asset-import-assistant-implementation-plan.md` Task 3。
