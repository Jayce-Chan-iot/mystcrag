# TASK-ASSET-QA-001 — 珠子素材入库集成验收记录

- 任务：`TASK-ASSET-QA-001`（一次性集成 / 架构 / 本地验收门，计划 Task 7）
- 分支：`task/asset-qa-001-integration-gate`（worktree `.worktrees/asset-qa-001`，基线 `6e79b66`）
- 执行：DeepSeek-V4-Flash（产品负责人 2026-09-09 授权接管最终 QA 修复，接替 GLM-5.3-Flash）
- 终审：GLM-5.3（2026-09-09 产品负责人授权接管最终审查；独立复核候选 `ae24f3d` 的九项重点核验，未发现 QA 门禁自身 Critical 缺陷；修复本记录沿用的上一轮运行过期标识 8 处，见“五、17”）
- 日期：2026-09-09（本记录；此前 2026-09-08 的 35 PASS 记录与 2026-09-09 的 45 PASS / 4 FAIL / 1 MISSING 记录均已被本轮真实浏览器结果**取代 superseded**）
- 结论：**BLOCKED —— review gate failed（47 PASS / 4 FAIL / 0 SKIP / 0 MISSING，退出码 1），清理 0 错误；review 未通过**。

发布路径已升级为**真实浏览器驱动**（合成 OIDC 拓扑 + 真实最终用户登录回环 + 目录选择经真实
`#bead-import-folder-input` 目录选择产生 manifest 与 PUT，全流程 UI）。目录可见性按产品负责人既定的
“严格诚实 FAIL”裁定：必须先经真实 UI 发布、再断言目录；发布负载缺 `modelAssetKey` 使成品不出现在设计
目录 → `flow/published-product-public` 与 `browser/approved-product-renders` **如实记 FAIL 并作为硬阻塞**，
直至一个前端任务让发布负载携带 `modelAssetKey`。另两条 FAIL 是**真实规模下暴露的 runtime 缺陷**（Next
10 MiB 路由体上限 + 真实源集自动分组不收敛），同样如实记录。本任务未修改任何 runtime 代码，
只修复 QA 脚本自身缺陷并补充证据；全部 FAIL 的修复归属于后续 runtime 任务（见“四、四项 FAIL 与根因”）。

## 一、真实命令

工作目录：`.worktrees/asset-qa-001`。

说明：本机默认 `python3` 是被 `PYTHONHOME`/`PYTHONPATH` 污染的沙箱解释器（缺 requests），实际使用 Homebrew Python 3.11.15 并显式解污染：

```bash
# 1. 语法编译
env -u PYTHONHOME -u PYTHONPATH /opt/homebrew/bin/python3 -m py_compile scripts/ui-qa/bead_import_flow.py

# 2. 架构测试（19/19 通过）
node --test tests/bead-asset-import-architecture.test.mjs

# 2b. 内建单元自检（不起服务/不建库/不开浏览器；finish-order + cleanup-two-phase + cross-pair-ok + process-group-termination 四个探针）
env -u PYTHONHOME -u PYTHONPATH /opt/homebrew/bin/python3 -u scripts/ui-qa/bead_import_flow.py --self-test

# 3. 完整集成验收（真实浏览器 + 真实 OIDC 登录 + 真实后端 + 真实 worker + 一次性测试库）
env -u PYTHONHOME -u PYTHONPATH /opt/homebrew/bin/python3 -u scripts/ui-qa/bead_import_flow.py
```

最终通过的记录性运行（干净一次性，无 `--keep`）结果：

```
SUMMARY: 47 passed, 4 failed, 0 skipped; required set complete; cleanup errors: 0
RUN_EXIT=1
```

结束后数据库、全部进程组（含孙进程）与临时目录均被清理：每个启动的进程组都经 `killpg(pgid,0)` 探测确认整组消失（leader 与孙进程，不止 leader 退出；无端口的 worker 以组消失探测为唯一证明），测试库删除后经 `pg_database` 复核 absent。

## 二、一次性测试数据库与环境

- 每次运行自动创建 `mystcrag_qa_flow_test_<unixtime>_<rand6>`（名称含 `test`），跑完 `DROP DATABASE ... WITH (FORCE)`。
- 本轮记录运行的测试库：`mystcrag_qa_flow_test_1788967781_59e71f`（已随脚本清理删除并复核 absent）。
- 认证：**合成 OIDC 拓扑** —— auth0 issuer 挂在 `synthetic.auth006.internal`；Node 预载
  `NODE_OPTIONS --require`；浏览器经 CONNECT relay 直达提供方；自签 CA 经 `NODE_EXTRA_CA_CERTS`；
  最终用户走真实 PKCE S256 authorize + redirect 回环（`browser/final-user-login` PASS）。管理台走独立
  admin key 门（`qa-integration-admin-key-0123456789`，合成值）。`.env` 未创建/修改。
- 归档根：临时目录（`mkdtemp("mystcrag-qa-flow-")` 下的 `archive/`，含后端归档、worker 日志、浏览器截图），
  运行前脚本显式 `mkdir`，结束后随清理删除（按治理要求不入库；本轮无 `--keep`，路径已随清理移除）。
- 脚本进程内强制 `no_proxy=*`：本机常驻外部代理会把 localhost 探活请求劫走返回 502。

## 三、逐项结果（记录性运行，`/tmp/qa001-final.log`）

环境与服务 / 一次性库：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 1 | env/postgres | PASS | `psql -h /tmp` 可达 |
| 2 | fixtures/synthetic | PASS | 11 个合成文件：同 stem 对、跨目录同 stem、重复哈希、纯 jpg、纯 ARW、差背景 + 拯救片 |
| 3 | db/fresh-test-database | PASS | `mystcrag_qa_flow_test_1788967781_59e71f` |
| 4 | services/oidc-provider | PASS | provider tls `:62642`、admin `:62643`、relay `:62644`；discovery 经 CONNECT relay + 自签 CA 验证 |
| 5 | services/backend | PASS | backend `:4100` HTTP-ready |
| 5b | services/worker | PASS | asset-worker 存活且无 fatal 启动错误（worker 无端口，存活+无 fatal 即已进入轮询；poll 1000ms） |
| 6 | services/frontend | PASS | next dev `:62620` |
| 7 | services/frontend-h2 | PASS | https/h2 反向代理 `:62687` → next dev `:62620` |

登录 / 建任务 / 上传 / 重启恢复：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 8 | browser/login+guard | PASS | guard 重定向到登录页；admin key 被接受进入管理台 |
| 9 | browser/create-session | PASS | 经 Dashboard 按钮真实创建会话（`cmtu98sz…`） |
| 10 | http/manifest | PASS | 11 文件登记；manifest POST 确由浏览器经目录选择真实发出（浏览器可见 1 次） |
| 11 | http/upload | PASS | 真实目录选择 `#bead-import-folder-input` 登记并暂存 11 文件；1 个文件 content PUT 被 h2 反代精确拦截一次（可重试网络失败），其余由 worker 归档 |
| 12 | flow/restart-termination | PASS | backend 进程组与 worker 进程组经 `killpg(pgid,0)` 探测确认整组消失（不止 leader 退出；worker 无端口，组消失探测是唯一证明）；4100 端口验证关闭 |
| 13 | flow/restart-new-pids | PASS | backend 36765→36895；worker 36766→36896 |
| 14 | flow/restart-resume | PASS | 会话与文件状态跨重启恢复（ARCHIVED/PENDING/SKIPPED_DUPLICATE） |
| 15 | flow/resume-upload-completes | PASS | 经 UI“重试上传”按钮恢复被拦截文件（1 次点击后归档） |
| 16 | flow/resume-archive-settles | PASS | 归档结算后会话进入 ARCHIVING（files=11） |
| 17 | flow/worker-advanced-after-restart | PASS | 重启后 worker 日志增长（19→115 字节），继续归档被拦截文件 |
| 18 | flow/sha256-archive-roundtrip | PASS | 每个 ARCHIVED 文件的权威会话 sha256 == 源字节 sha == 临时归档文件字节 sha |

分组 / 合并 / 拆分 / 命名：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 19 | browser/grouping-start | PASS | 从会话页真实点击按钮发起分组，BFF 返回 200 |
| 20 | flow/auto-grouping | PASS | 合成批次自动归出 5 组 |
| 21 | flow/merge | PASS | 5 → 4 组 |
| 22 | flow/split | PASS | 拆回 5 组（no-op split 视为失败） |
| 23 | flow/arw-only-merge | PASS | 纯 ARW 组并入含光栅组（操作员路径） |
| 24 | flow/primary-confirmed | PASS | 每组主文件均为人工确认的光栅 |
| 25 | browser/groups-page-render | PASS | 确认分组 panel 在真实浏览器渲染（desktop-03-groups.png） |
| 26 | flow/naming | PASS | 4 组人工命名（名称不来自图像/目录推断） |

草稿 / 目录可见性 / QC / 审批：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 27 | flow/draft | PASS | 经浏览器草稿表单保存；crystalDraftId `cmtu997pa000…` |
| 28 | flow/catalog-requires-auth | PASS | 匿名目录请求被 401 拒绝（protected route） |
| 29 | flow/draft-public-denial | PASS | 发布前草稿 SKU 不出现在认证目录 |
| 30 | flow/curation | PASS | 水晶八项 curation 字段人工填写并接受 |
| 31 | flow/draft-refresh-persistence | PASS | 全新会话读取后重新核验 crystalDraft 的八项 curation 字段 + curationComplete + revision 1→2 与提交值一致；页面 reload 后再次核验字段值与完成状态（不只等步骤标题） |
| 32 | browser/draft-page-render | PASS | 命名与草稿 panel reload 后重渲染（八项输入回填 + crystalDraft 完成态与 revision 存活，desktop-04-draft.png） |
| 33 | flow/processing-start | PASS | 经浏览器按钮启动处理 |
| 34 | flow/qc-verdict | PASS | 差背景版本 QC_FAILED（isCurrent=False） |
| 35 | flow/qc-blocks-approval | PASS | 对 QC_FAILED 请求审批被 HTTP 409 `error.code='CONFLICT'` 拒绝 |
| 36 | browser/qc-blocks-ui-approval-button | PASS | QC_FAILED 卡片显示“质检未通过”与“质检问题”，且该版本无“提交批准”按钮 |
| 37 | flow/qc-recovery-reprocess | PASS | 操作员切换主文件到拯救片并 reprocess |
| 38 | flow/qc-recovery-passed | PASS | 拯救主片 v2 为 QC_PENDING |
| 39 | flow/human-approval | PASS | 全部组人工批准；返回权威 approvedAssetKey |
| 40 | browser/review-page-render | PASS | 处理、审核与发布 panel 在真实浏览器渲染（desktop-05-review.png） |

发布 / 公开渲染 / 目录可见性 / 视口：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 41 | flow/publish | PASS | 经真实浏览器发布表单（loader → BFF → backend）；`publishedAssetKeys=['approved:13f65529…c0ae8']`；inventory snapshot present |
| 42 | flow/public-approved-asset | PASS | 已批准 key 经公开 `/api/assets` 返回 200 `image/webp` |
| 43 | flow/published-product-public | **FAIL** | 真实 UI 发布后，成品不出现在认证设计目录（catalog 查询为空）——发布负载缺 `modelAssetKey`，目录 `materials()` 过滤要求其非空。见“四、根因 ①” |
| 44 | browser/final-user-login | PASS | 最终用户经真实合成 OIDC authorize + PKCE redirect 回环登录 |
| 45 | browser/approved-product-renders | **FAIL** | `/crystal-library` 上没有任何 `<img>` 引用已发布的 approved 资产——同根因①：珠子不在设计目录中，页面无图可渲染 |
| 46 | mobile/status-reviews-viewport | PASS | 390x844 无横向溢出（scrollWidth=390 clientWidth=390） |

真实素材只读导入（`/Users/chenyanyan/Desktop/珠子图`，127 文件 / 66 stem / 1 跨目录 stem / 1.32 GB）：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 47 | sources/discovery | PASS | 127 文件（65 JPG + 62 ARW）、26 顶层目录、66 stem、跨目录 stem `['ZDX01535']`、4 个 jpg-only stem、1 个 arw-only stem；基线 dirs/files/JPG/ARW=`{26, 127, 65, 62}` 精确匹配 |
| 48 | sources/proxy-large-body-cap | **FAIL** | 62/127 个真实文件（首个 `1/ZDX01448.ARW` 21,190,656 字节）经真实管理代理失败（500 `INTERNAL_ERROR: The bead import service did not respond`，前端 10 MiB 路由体上限截断）。62 个全部直连回退到同一后端内容路由成功并被归档/哈希/分组完整性核对覆盖（import-roundtrip 已 PASS）。见“四、根因 ②” |
| 49 | sources/import-roundtrip | PASS | 127 个真实文件字节一致归档（65 经真实管理代理无错误；62 直连回退——经 20s 有界等待重读权威 session 转 FAILED/PENDING 后成功重试）；权威 sha256 逐文件匹配，6 个抽样归档文件重哈希字节一致 |
| 50 | sources/grouping-pairs | **FAIL** | 127 个真实文件触发自动分组后，240s 有界等待内状态停在 `PARTIALLY_FAILED` 且 `groups=0`（worker 从未产出任何分组）。见“四、根因 ③” |

## 四、四项 FAIL 与根因（全部如实记录，硬阻塞，未在本任务修复）

| 根因 | FAIL 检查 | 证据 | 现象 | 修复归属 |
|---|---|---|---|---|
| ① 发布负载缺 `modelAssetKey` | flow/published-product-public；browser/approved-product-renders | 本条运行第 43/45 行；`apps/frontend/.../admin-bead-import/processing-loader.ts`（发布候选只带 `textureAssetKey`，无 `modelAssetKey`）；`design-api.service.ts` 目录 `materials()` 过滤丢弃 `modelAssetKey` 为空的行；仓库 `modelAssetKey ?? null` | 真实 UI 发布成功、`/api/assets` 200，但成品从认证目录与 `/crystal-library` 消失 | **前端任务**：让发布负载发送 `modelAssetKey=<已批准主图>`（与 `textureAssetKey` 同一已批准主图，后端显式支持的同资产路径）；修复后两条 FAIL 应变 PASS |
| ② Next 默认 10 MiB 路由体上限 | sources/proxy-large-body-cap | frontend.log `Request body exceeded 10MB …`；`next.config.ts` 无体积覆盖；解析后服务端配置 `proxyClientMaxBodySize: 10485760`；代理 500 “The bead import service did not respond.”；后端 Fastify 上限实为 256 MiB | 62 个 ~21 MB Sony ARW 无法经管理代理上传；后端与 worker 直连收 21 MB 完全正常 | **前端服务器配置任务**：上调路由体上限至 ≥256 MiB（或特征级每文件上限），使 ARW 可经代理走完整 BFF 链路 |
| ③ 真实源集自动分组不收敛 | sources/grouping-pairs | 127 个真实文件触发自动分组后，240s 有界等待内状态停在 `PARTIALLY_FAILED` 且 `groups=0`（worker 从未产出任何分组） | 真实 127 文件整包导入已字节一致归档，但自动分组无法结算，分组/配对无法评估 | **worker 任务**：修复 127 文件真实源集下的自动分组收敛（11 文件合成集能收敛，127 文件真实集停在 PARTIALLY_FAILED） |

“严格诚实”说明：`flow/published-product-public` 与 `browser/approved-product-renders` 两条按产品负责人裁定**不折算、不跳过**——成品目录可见性必须以真实 UI 发布为前置并如实断言；
正因为此诚实断言，① 号加载器缺陷才作为硬阻塞浮出。`sources/proxy-large-body-cap` 是真实规模下的代理体上限缺陷（②）：62 个 >10 MiB 文件经代理失败后，
直连回退对有界等待（20s）重读权威 session 后转 FAILED/PENDING（保留确已释放）的文件成功重试，故 `sources/import-roundtrip` 如实 PASS（127 文件字节一致归档，不是绕过后宣称完整）。
上一轮记录性运行（45 PASS / 4 FAIL / 1 MISSING）中 `sources/import-roundtrip` 曾因单次 409 误判保留未释放而 FAIL、`sources/grouping-pairs` 曾 MISSING，其结论**已被本轮取代**：
本轮 import-roundtrip 因保留确已释放（有界等待后转 FAILED/PENDING 并成功重试）而 PASS，grouping-pairs 因 127 文件真实源集自动分组 240s 不收敛（`PARTIALLY_FAILED` `groups=0`）而 FAIL。

## 五、执行中发现并修复的脚本缺陷（仅改 QA 脚本与文档，未动 runtime）

1. **`flow/arw-only-merge` 回归修复**：`merge` 演练的候选集合此前包含纯 ARW 组，合并+对半切会把纯 ARW 组并进栅格组、破坏后续 arw-only-merge 定位。现合并演练只允许含栅格成员的组参与（`_group_is_arw_only` 过滤），纯 ARW 组留给专门的 arw-only-merge 路径 → 本项 PASS。
2. **sources 上传循环崩溃修复**：直连后端诊断路径此前未捕获异常，首个滞留 UPLOADING 文件的 409 会崩掉整个 sources 阶段、令 `sources/proxy-large-body-cap` 永远不报告。现直连失败被 `direct_backend_failures` 捕获并逐个记录，`sources/proxy-large-body-cap` 如实报告 62 个代理失败，`sources/import-roundtrip` 对每个 409 做 20s 有界等待重读权威 session，仍 UPLOADING 才判 stuck 并快速失败（不再白等 600s 结算，也不再凭单次 409 断言“永不释放”）。
3. **`finish()` 先执行 cleanup、再冻结 problems / 打印 SUMMARY**：清理期新增的 `CLEANUP_ERRORS` 必然改变退出码与 SUMMARY（不再恒为 “cleanup errors: 0”）。
4. **processing-start 的 `expect_response` 包住 click**：消除点击后监听导致漏响应竞态。
5. **cleanup 两阶段 + 去重端口检查**：只对本次启动且仍存活的进程组发信号、统一收割、最后对去重端口检查关闭；绝不对已退出的旧 PGID 无条件 killpg。
6. **>10 MiB 上传分层**：删除按字节数无条件判大文件 FAIL/绕行的逻辑；每个文件先真实走前端代理，只有真实观察到的 500/截断/连接错误才记 `sources/proxy-large-body-cap`，随后直连同一后端内容路由仅作诊断；前端修复 body cap 后本门自动 PASS。
7. **curation 持久化从全新会话读取核验**：八项 curation 字段 + curationComplete + revision 与提交值一致，reload 后再核验输入回填与完成态。
8. **QC 负向守卫**：锁定 HTTP 409 + `error.code='CONFLICT'`；401/400/404 不算 PASS；UI 无批准按钮单独证明。
9. **真实源发现/stat/hash/read 隔离在 5s 可强杀子进程**：超时诚实 FAIL 且 cleanup 运行。
10. **cross_pair_ok 的 `all(bool)` TypeError 修复**：改回确定性布尔聚合，新增成功分组回归。
11. **进程组终止证明（含孙进程/无端口 worker/PID-PGID 重用防护）**：新增 `_process_group_alive(pgid)`（`killpg(pgid,0)` 探测）；`stop_process_group` 与 `cleanup()` 都在 leader 退出后继续证明整组消失，孙进程仍活则补 SIGKILL；只有“本次确实发过信号且组仍存活”才补 SIGKILL，绝不对已消失旧 PGID 无条件 killpg。无端口的 worker 以组消失探测为唯一“旧组消失”证明。新增 `--self-test` 探针 `process-group-termination`（leader 先退、孙进程无视 SIGTERM 仍活 → 整组被杀）。
12. **stuck 判定改为有界等待 + 重读权威 session**：直连 409 不再推断“终态 UPLOADING/永不释放”；`_wait_upload_released` 有界等待重读 session，转 FAILED/PENDING（保留释放）则走允许的真实重试，只有超时仍 UPLOADING 才判 stuck（前端修复后本门自动 PASS）。
13. **proxy-large-body-cap 文案收紧**：只宣称直连回退**成功**的文件被归档/哈希/分组覆盖；回退失败的文件如实声明不被覆盖，不再宣称“every real file covered”。
14. **源操作全部进 5s 可强杀子进程**：`_discover_source_set` 在子进程内返回 `is_dir` 与每文件 size/mtime；主进程 manifest 复用 discovery 的 size/mtime，删除主进程的 `source_set.is_dir()` 与逐文件 `path.stat()`。
15. **完整验收强制权威路径**：`--source-set` 非 `/Users/chenyanyan/Desktop/珠子图` 时 `sources/discovery` 如实 FAIL（diagnostic-only，不得让完整门禁退出 0），且基线精确核对 26 目录/127 文件/65 JPG/62 ARW。
16. **PASS 收紧**：`flow/merge` 验证合并组成员全集 == 两源组并集；`flow/split` 验证分区全集/互斥/无串组；`flow/primary-confirmed` 重读权威 session 逐组复核 primaryFileId（不再硬编码 True）；`flow/publish` 要求 `inventorySnapshotId` 有效非空（任意非空错误 JSON 不得 PASS）；`services/backend+worker` 拆为 `services/backend` + `services/worker`（worker 就绪 = 存活且无 fatal）；`sources/proxy-large-body-cap` 加入 `REQUIRED_RESULTS`。
17. **终审标识勘误（GLM-5.3，2026-09-09）**：本记录此前把上一轮（已被取代的 45 PASS / 4 FAIL / 1 MISSING 运行）的一次性库名、OIDC/前端/h2 端口、会话 ID、重启 PID 对与 crystalDraftId 共 8 行过期标识误写进“本轮记录性运行”的正文与表格；已按 `/tmp/qa001-final.log` 第 3/4/7/8/10/14/28 行逐项订正（库名 `mystcrag_qa_flow_test_1788967781_59e71f`、provider `:62642`/`:62643`/`:62644`、next dev `:62620`、h2 `:62687`、会话 `cmtu98sz…`、backend 36765→36895 / worker 36766→36896、crystalDraftId `cmtu997pa000…`）。QA 脚本、架构测试与门禁结果（47/4/0/0，EXIT=1）不变。

本轮验证：`py_compile` OK；`--self-test` 四探针 PASS；架构测试 19/19；`pnpm validate` 17/17；`git diff --check` clean；最终门禁 47 PASS / 4 FAIL / 0 SKIP / 0 MISSING，cleanup errors 0，EXIT=1。

## 六、风险与建议

- **硬阻塞（发布类）**：在 ① 修复前，真实发布的产品对设计目录与 `/crystal-library` 不可见；这是前端 loader 的发布负载缺口，与后端正向接受路径无关。
- **规模缺陷**：② 影响任何 >10 MiB 的真实 ARW（本机桌面集 62/127 个），只能经直连回退归档（import-roundtrip 已 PASS）；③ 是 127 文件真实源集下的自动分组收敛缺陷——三者（①②③）修复前，成品目录不可见、>10 MiB ARW 无法经管理代理上传、真实源集自动分组无法结算。
- 集成脚本依赖本机 Homebrew PostgreSQL（`psql -h /tmp`）与已安装的 pnpm 依赖，非 CI 可重放环境；前端 dev 冷启动偶发超 240 秒。
- 运行期间若脚本被强杀（kill -9），进程组兜底不会执行，可能留下孤儿 next-server 持有项目锁；下次运行前需手动清理。
- 记录性运行证据：`/tmp/qa001-final.log`（完整输出，RUN_EXIT=1）；`pnpm validate`：`/tmp/qa001-validate.log`（如需）。截图与归档均在一次性临时目录内、随清理删除，未入库（治理要求）。
- 本任务严格未修改 runtime 产品代码、契约、Prisma、根配置与 lockfile；改动限于 `scripts/ui-qa/bead_import_flow.py`、`tests/bead-asset-import-architecture.test.mjs`、本文档与 TASK_REGISTRY 本任务行。
