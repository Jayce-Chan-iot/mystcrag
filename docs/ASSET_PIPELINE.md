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
| SOL 修复提交 | `1fbfcdc`(第 1 轮,§10.3) |
| SOL 第 2 轮修复提交 | `ca480bf`(§10.4,基于 `9ea6fc4`) |
| SOL 第 3 轮修复提交 | `f5b5d97`(§10.5,基于 `4414c3b`) |
| 当前状态 | REVIEW:SOL 验收第 1 轮 5 项 + 第 2 轮 4 项 + 第 3 轮 4 项问题已修复(§10.3–§10.5) |

## 2. 模块与接口

### 2.1 `packages/asset-pipeline`(已完成)

| 模块 | 关键导出 |
| --- | --- |
| `content-type.ts` | `detectAssetSourceKind(bytes): DetectedAssetSourceKind \| null`(魔数检测:ARW/JPEG/PNG/WEBP)。ARW 需完整 TIFF 结构(大小端魔数、IFD 偏移与条目边界)且 IFD0 同时携带 Make=SONY **与至少一项 RAW 专用证据**:Sony RAW 压缩码 32767 或 CFA 光度解释 32803,证据可在 IFD0 本身或 SubIFDs 指针指向的 SubIFD 条目中(SubIFD 自身是通用 TIFF 结构,空 SubIFD、RGB SubIFD、仅 Make=SONY 的普通 TIFF、无 Make、其他厂商、裸头、截断或损坏均判 `null`,fail-closed,不凭扩展名)。这是基于内容证据的判定,不是对全部 TIFF 变体的完备定义:无法证明即拒绝,宁可漏判不可误判 |
| `hash.ts` | `sha256OfBytes`, `sha256OfFile`, `FileDigest` |
| `pairing.ts` | `pairRawAndJpeg(files): PairingOutcome`(跨目录同 stem RAW/JPG 配对) |
| `storage.ts` | `ArchiveStore`(`putOriginal`/`putProcessed`/`putStaging`/`removeStaging`/`read`/`verifiedRead`/`listSessionFiles`,原子 link+unlink、防符号链接越界、同 key 不同内容拒绝;仅 staging 可删除,raw/processed 不可变) |
| `grouping.ts` | `computeDHash`, `computeColorHistogram`, `hammingDistance`, `histogramDistance`, `suggestGroups`, `GROUPING_THRESHOLDS`。候选必须携带 `kind`;同 stem 强配对按**原始候选数量**计数:仅"恰好一个 ARW 候选 + 恰好一个 JPEG 候选"(1+1)直接高置信配对,精确重复折叠后的组件数不参与判定(两个完全相同的 ARW 折叠成一个组件后仍按 2 个 ARW 计,不得借 stem 边并入 JPEG),2 ARW+1 JPEG、1+2、2+2 等歧义组合不凭 stem 合并;两张 JPEG/PNG/WebP 同 stem 不得仅凭文件名高置信度合并。所有影响输出、成员、代表项与 evidence 顺序的排序使用 UTF-16 代码单元比较器(不依赖系统 locale,`é` 与 `e\u0301` 等在 localeCompare 下可能相等的 ID 顺序固定),建议与证据完全确定,与输入顺序无关 |
| `image-processor.ts` | `processBeadImage`(保真扣图,512/256 透明 WebP,`PROCESSOR_VERSION = "faithful-v1"`,不放大主体) |
| `quality.ts` | `runQualityChecks`(11 项数值 QC,失败不静默通过) |

### 2.2 `apps/asset-worker`(本阶段交付)

- `src/repository-roots.ts`:Git worktree 根发现。优先 `git worktree list --porcelain`(以模块目录为 cwd,5 s 超时),得到当前 worktree、主 checkout 与所有已注册兄弟 worktree;porcelain 路径仅忽略"明确标记 prunable **且未锁定**且目录缺失"的条目,locked 缺失、非 prunable 缺失、无法 realpath、非目录均 fail-closed。git 不可用或命令失败时回退文件系统走查:向上定位 `.git`(目录,或解析 linked-worktree `.git` 文件的 `gitdir:` 指针),再经 common git dir(`commondir` 文件推导)的 `worktrees/<name>/gitdir` 注册表**枚举全部已注册 worktree**。注册表条目必须是可验证的目录(文件、符号链接均抛错);gitdir 文件必须可读、非空且解析后指向该 worktree 的 `.git`;主 checkout 不可达抛错。fallback 无法证明 prunability:登记项目标缺失(ENOENT)一律 fail-closed 拒绝启动——locked 且目标缺失、目标缺失但无法证明可清理,均抛 `RepositoryRootsError`;仅 porcelain 明确标记 prunable 才允许忽略不存在路径。两条路径都无法识别仓库时同样抛 `RepositoryRootsError` 拒绝启动(无法证明档案根安全即不启动)。所有根经 realpath 归一。
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
- GROUP_SESSION:每个 `files[i].archiveKey` 必须严格匹配 `^imports/<sessionId>/raw/<64-hex>.(arw|jpeg|jpg|png|webp)$` 且 sessionId 等于 `job.sessionId`,并做跨字段一致性:key 内摘要 === `files[i].sha256`,key 扩展名与声明 kind 对应(arw→ARW、jpg/jpeg→JPEG、png→PNG、webp→WEBP)。逐条校验,不只检查首条。
- PROCESS_GROUP:先校验 `payload.groupId === job.groupId`(防止输出写入错误 group 路径),再逐条校验每个 `files[i].archiveKey` 的语法、session 归属与 key 内摘要 === `files[i].sha256`。
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

高置信度合并要求视觉信号与拍摄时间**同时**满足;只有单项满足的进入低置信度复核建议。同 stem 强配对仅限精确重复折叠后恰好一个 ARW + 恰好一个 JPEG(原始+机内 JPEG 的 1+1);ARW/JPEG 任一侧出现多候选(如跨目录重复相机文件名的 2+1、1+2、2+2)即视为歧义,不凭 stem 自动合并——成员保持独立,或仅在视觉+时间阈值独立满足时合并,歧义对可进入低置信度复核证据,绝不静默择一。两张 JPEG/PNG/WebP 即使同名也不凭文件名合并,必须走上述视觉+时间阈值。

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
- **备份要求**:`MYSTCRAG_ASSET_ARCHIVE_ROOT` 指向的目录必须纳入独立于 Git 的备份策略(§2.2 的 worktree 防护拒绝把档案根放进任何**已发现**的 worktree,降低原片进入 Git 历史的风险;防护覆盖全部已注册 worktree,未向 Git 注册的目录树副本不在其列,故仍须独立备份);数据库按常规 PostgreSQL 备份。原片与数据库应保持备份点接近(数据库行引用档案 key)。
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

### 2026-09-04 SOL 验收第 2 轮修复(基线 `9ea6fc4`,分支 `task/asset-worker-001-local-pipeline`,worktree `.worktrees/asset-worker-001`)

SOL 第 2 轮验收提出 4 项问题(3×P1、1×P2),全部以"先补失败测试、再修复"处理;任务保持 REVIEW,未推送、未合并、未开始 Task 4、未处理 A7/Batch B。

修复项与对应测试:

| # | 问题 | 修复 | 测试 |
| --- | --- | --- | --- |
| P1-6 | Git 不可用时 filesystem fallback 只发现当前 worktree 与主 checkout,主 checkout 之外的兄弟 worktree 仍可能被选作档案根 | `discoverRepositoryRootsFromFilesystem` 经 common git dir(`commondir`/`.git` 目录)的 `worktrees/<name>/gitdir` 注册表枚举**全部**已注册 worktree;porcelain 路径仅忽略"明确标记 prunable 且目录缺失"的条目,非 prunable 缺失 fail-closed;注册表条目目录可验证不存在(ENOENT)才视为 prunable,无法 realpath、非目录、注册表/gitdir 不可读均抛 `RepositoryRootsError` | `archive-root-guard.test.ts` 新增 8 项:主 checkout 外兄弟 worktree 枚举、从主 checkout 出发仍枚举注册的 linked worktree、注册目录丢失(prunable 等价)跳过、porcelain 非 prunable 缺失 fail-closed、注册路径非目录/无法 realpath fail-closed、兄弟 worktree 内目录与指向它的符号链接拒绝、真仓库上 git 报告的每个 root 在无 git fallback 下同样受保护;"plain checkout"用例重写为真无注册 worktree 的 checkout fixture |
| P1-7 | 仅凭 Make=SONY 标签判定 ARW,任何结构合法的 SONY TIFF 都会被当成 ARW | `isSonyArw` 要求 IFD0 同时含 Make=SONY **与至少一项 RAW 专用证据**:指向缓冲区内合法 IFD 头的 SubIFDs 指针链、Sony RAW 压缩码 32767、CFA 光度解释 32803;无证据判 `null`(fail-closed),不依赖文件扩展名 | `content-type.test.ts` 新增 3 项:Make=SONY 但 photometric=2 无 RAW 证据的普通 TIFF 反例判 null、越界 SubIFDs 指针不算证据、三种 RAW 证据各自在大小端独立成立;`image-processor.test.ts` 的 `syntheticSonyArw` 大小端 fixture 补 SubIFDs 指针链(所用 RAW 证据见 §2.1) |
| P1-8 | raw archiveKey 与 sha256/kind 无跨字段一致性:key 摘要可 ≠ `file.sha256`,扩展名可 ≠ `file.kind` | 新增 `parseRawKey`(返回 sessionId/摘要/扩展名);GROUP_SESSION 在任何存储访问前校验 key 摘要 === `file.sha256` 且扩展名与 kind 对应(arw→ARW、jpg/jpeg→JPEG、png→PNG、webp→WEBP);PROCESS_GROUP 校验语法、session 归属与 key 摘要 === `entry.sha256` | `payload-isolation.test.ts` 新增 5 项(全部在 refusing store 上证明拒绝先于 read/verifiedRead):GROUP_SESSION 摘要矛盾、`.png` key 冒充 ARW kind、第二条文件摘要矛盾(逐条校验)、PROCESS_GROUP 摘要矛盾、一致的 `.jpeg`+JPEG 通过并到达 store;`jobs.test.ts` GROUP_SESSION fixture 的 kind 修正为 PNG 与 `.png` key 自洽 |
| P2-9 | 同 stem 每个 ARW×JPEG 执行 union,2 ARW+1 JPEG 形成三成员高置信组,跨目录重复相机文件名误合并 | stem 桶按精确重复折叠后的**组件数**计数:仅"恰好一个 ARW 组件 + 恰好一个 JPEG 组件"直接高置信配对;2+1、1+2、2+2 歧义不凭 stem 合并,成员保持独立;比 `pairing.ts` 的确定性择优语义更严格——分组绝不静默择一,歧义项保持独立或进入低置信度复核 | `grouping.test.ts` 新增 5 项:2 ARW+1 JPEG 不自动合并、1 ARW+2 JPEG 不自动合并、2+2 保持四个独立建议、歧义集合输出与输入顺序无关、精确重复 ARW 折叠后 1 JPEG 仍完成配对 |

红灯证据(实际执行;以 `git stash` 暂存 4 个实现文件、仅保留新测试对旧实现运行后恢复):

- `pnpm --filter @mystcrag/asset-pipeline test`(旧实现 + 新测试):78 tests,pass 73,**fail 5**——`a plain TIFF with a SONY Make but no RAW-specific evidence is not an ARW`、`a SubIFDs pointer that leaves the file does not count as RAW evidence`、`two ARWs and one JPEG of the same stem never auto-merge on the stem`、`one ARW and two JPEGs of the same stem never auto-merge on the stem`、`two ARWs and two JPEGs of the same stem stay four independent suggestions`。
- `pnpm --filter @mystcrag/asset-worker test`(旧实现 + 新测试):52 tests,pass 40,**fail 11**——worktree 防护 7 项(主 checkout 出发枚举、porcelain 非 prunable fail-closed、兄弟枚举、非目录 fail-closed、无法 realpath fail-closed、兄弟内目录与符号链接拒绝、真仓库 parity),跨字段 4 项(GROUP_SESSION 摘要矛盾、`.png` 冒充 ARW、逐条校验、PROCESS_GROUP 摘要矛盾)。

真库环境与测试库(真实创建,均全新空库,migrate 后执行;PostgreSQL 17.10,Homebrew,aarch64):

- Worker 联调:`mystcrag_assetworker001_r2_test_20260904`
- `pnpm db:test`:`mystcrag_assetworker001_r2_dbtest_20260904`

本阶段真实执行记录(全部实际执行):

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @mystcrag/asset-pipeline lint` / `typecheck` / `test` | 通过;测试 78/78(0 fail,0 skipped;第 1 轮后 70 + 新增 8) |
| `pnpm --filter @mystcrag/asset-worker lint` / `typecheck` | 通过(`tsc --noEmit`) |
| `pnpm --filter @mystcrag/asset-worker test`(单元,无库环境) | 51 通过 + 1 skipped(集成环境门控),0 fail |
| `pnpm --filter @mystcrag/asset-worker test`(真库联调 `mystcrag_assetworker001_r2_test_20260904`) | 63/63 通过,0 fail,0 skipped(单元 51 + 集成 12) |
| `pnpm db:test` | 178/178 通过(0 fail,0 skipped);库 `mystcrag_assetworker001_r2_dbtest_20260904`(全新空库) |
| `pnpm validate` | 通过;turbo 17/17 任务成功(15 缓存命中,2 实际执行) |
| `git diff --check f17fa2e..HEAD` / `git status --short --branch` | 通过(提交后确认) |

变更文件(相对 `9ea6fc4`,共 11 个):`apps/asset-worker/src/{jobs,repository-roots}.ts`、`packages/asset-pipeline/src/{content-type,grouping}.ts`、`apps/asset-worker/tests/{archive-root-guard,jobs,payload-isolation}.test.ts`、`packages/asset-pipeline/tests/{content-type,grouping,image-processor}.test.ts`、本文件。无数据库/Prisma/共享 Contract/后台/前端/知识库改动,无新增运行时依赖,变更集无任何图片/二进制文件(全部 fixture 为 SVG→sharp PNG 或 `buildTiff`/`syntheticSonyArw` 合成字节)。

### 2026-09-04 SOL 验收第 3 轮修复(基线 `4414c3b`,分支 `task/asset-worker-001-local-pipeline`,worktree `.worktrees/asset-worker-001`)

SOL 第 3 轮验收提出 4 项问题(3×P1、1×P2),全部以"先补失败测试、再修复"处理;任务保持 REVIEW,未推送、未合并、未开始 Task 4、未处理 A7/Batch B。

修复项与对应测试:

| # | 问题 | 修复 | 测试 |
| --- | --- | --- | --- |
| P1-10 | filesystem fallback 并非真正 fail-closed:common git dir 下非目录 registry entry 被直接跳过;空/畸形 gitdir 内容被当作路径继续解析;目标 ENOENT 一律被当成 prunable,即使 worktree 为 locked 或无法证明可清理 | 注册表枚举中每个 `worktrees/<name>` 登记项必须是可验证的目录(文件、符号链接均抛 `RepositoryRootsError`);gitdir 文件必须可读、非空(trim 后非空)且解析目标必须指向该 worktree 的 `.git`(basename 校验),否则抛错;主 checkout 不可达同样抛错。Git CLI 不可用时 fallback 无法证明 prunability:登记项目标缺失一律 fail-closed——locked(`worktrees/<name>/locked` 存在)且目标缺失、目标缺失但无法证明可清理,均抛 `RepositoryRootsError` 拒绝启动;仅 porcelain 明确标记 prunable(且未锁定)才允许忽略不存在路径 | `archive-root-guard.test.ts` 新增/重写 7 项:locked 且 porcelain 标记 prunable 仍拒绝(porcelain 路径)、fallback 中目标缺失无法证明 prunable 拒绝(原"跳过 prunable"用例反转)、locked 且目标缺失拒绝、空 gitdir 拒绝、gitdir 指向非 `.git` 路径拒绝、registry entry 为文件或符号链接拒绝、真仓库存在缺失登记项时 fallback fail-closed(原 parity 用例重写) |
| P1-11 | SubIFDs 单独作为 ARW 证据:Make=SONY + 任意合法/空 SubIFD 即判 ARW,但 SubIFDs 是通用 TIFF 标签 | 删除"SubIFD 存在即为 RAW"逻辑;SubIFDs 指针仅在指向的 SubIFD 条目本身携带 RAW 标记时才算证据——解析每个指向的 SubIFD 的全部条目,发现 CFA 光度解释(32803)或 Sony RAW 压缩码(32767)才计;IFD0 中的 CFA/RAW compression 仍可直接作为证据。空 SubIFD、RGB SubIFD、普通 Sony TIFF 返回 `null` | `content-type.test.ts`:fixture 重构为 `ifdCompression`/`ifdCfa`/`subIfdCfa`/`subIfdCompression`/`subIfdRgb`/`subIfdEmpty`/`none` 七种证据形态,新增空 SubIFD、RGB SubIFD 两个反例(判 null),四种真实证据大小端各自成立;`image-processor.test.ts` 的 `syntheticSonyArw` 补真实 SubIFD 条目(Sony RAW compression 32767) |
| P1-12 | 2+1 同 stem 经重复折叠绕过:stem 配对用 `rawRoots.size/jpegRoots.size`,两个完全相同的 ARW 折叠成一个 root 后与一个 JPEG 组成三文件高置信组 | stem 强配对改用**原始候选数量** `raws.length === 1 && jpegs.length === 1`;任何 2+1、1+2、2+2 均不建立 stem 合并边;精确重复仍可形成自己的 duplicate group,但不得借 stem 边传递合并 JPEG | `grouping.test.ts`:反转原"exact-duplicate ARWs collapse before stem pairing"错误用例为"two identical ARWs and one JPEG of the same stem never form a three-member group"——同摘要 ARW×2 + JPEG×1 仅形成 {raw1,raw2} 重复组,JPEG 保持独立建议,重复组 evidence 无 stemPairedWith |
| P2-13 | `localeCompare` 非确定性:clientFileId 允许 Unicode,`é` 与 `e\u0301` 可能返回 0,排序结果依赖输入顺序或运行环境 | `grouping.ts` 中所有影响输出、成员、代表项与 evidence 顺序的 5 处 localeCompare(候选排序、高置信成员排序、高置信建议排序、复核成员排序、复核建议排序)全部替换为确定性 UTF-16 代码单元比较器 `compareByCodeUnits`(`a < b ? -1 : a > b ? 1 : 0`),不依赖系统 locale | `grouping.test.ts` 新增"precomposed 与 combining Unicode ID 正反序结果 deepEqual":`é-shot`(U+00E9)与 `e\u0301-shot` 输入顺序互换后输出逐字节一致,且代码单元序固定为组合序列在前;`grep` 核对 grouping.ts 无残留 localeCompare(pairing.ts 的 relativePath 排序不在本项验收范围) |

红灯证据(实际执行;以 `git diff` 暂存 3 个实现文件补丁、`git checkout` 还原实现仅保留新测试对旧实现运行后 `git apply` 恢复):

- `pnpm --filter @mystcrag/asset-pipeline test`(旧实现 + 新测试):81 tests,pass 77,**fail 4**——`an empty SubIFD provides no RAW evidence on its own`、`a SONY TIFF with an ordinary RGB SubIFD is not an ARW`、`two identical ARWs and one JPEG of the same stem never form a three-member group`、`grouping output is deterministic for precomposed and combining Unicode ids`。
- `pnpm exec tsx --test tests/archive-root-guard.test.ts`(旧实现 + 新测试):21 tests,pass 14,**fail 7**——locked+prunable porcelain、fallback 目标缺失、locked 目标缺失、空 gitdir、gitdir 非 `.git`、registry entry 文件/符号链接、真仓库不可证明登记项。

真库环境与测试库(真实创建,均全新空库,migrate 后执行;PostgreSQL 17.10,Homebrew,aarch64):

- Worker 联调:`mystcrag_assetworker001_r3_test_20260904`
- `pnpm db:test`:`mystcrag_assetworker001_r3_dbtest_20260904`

本阶段真实执行记录(全部实际执行):

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @mystcrag/asset-pipeline lint` / `typecheck` / `test` | 通过;测试 81/81(0 fail,0 skipped;第 2 轮后 78 + 新增/重构 3) |
| `pnpm --filter @mystcrag/asset-worker lint` / `typecheck` | 通过(`tsc --noEmit`) |
| `pnpm --filter @mystcrag/asset-worker test`(真库联调 `mystcrag_assetworker001_r3_test_20260904`) | 68/68 通过,0 fail,0 skipped(单元 56 + 集成 12;第 2 轮后 63 + worktree 防护新增 5) |
| `pnpm db:test` | 178/178 通过(0 fail,0 skipped);库 `mystcrag_assetworker001_r3_dbtest_20260904`(全新空库) |
| `pnpm validate` / `git diff --check f17fa2e..HEAD` / `git status --short --branch` | 通过(提交后确认) |

变更文件(相对 `4414c3b`,共 9 个):`apps/asset-worker/src/repository-roots.ts`、`packages/asset-pipeline/src/{content-type,grouping}.ts`、`apps/asset-worker/tests/archive-root-guard.test.ts`、`packages/asset-pipeline/tests/{content-type,grouping,image-processor}.test.ts`、本文件与 `docs/tasks/TASK_REGISTRY.md`。无数据库/Prisma/共享 Contract/后台/前端/知识库改动,无新增运行时依赖,变更集无任何图片/二进制文件(全部 fixture 为 SVG→sharp PNG 或 `buildTiff`/`syntheticSonyArw` 合成字节)。G5(§7)保持登记不变。

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
