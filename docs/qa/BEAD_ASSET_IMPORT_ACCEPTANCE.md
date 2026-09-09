# TASK-ASSET-QA-001 — 珠子素材入库集成验收记录

- 任务：`TASK-ASSET-QA-001`（一次性集成 / 架构 / 本地验收门，计划 Task 7）
- 分支：`task/asset-qa-001-integration-gate`（worktree `.worktrees/asset-qa-001`，基线 `6e79b66`）
- 执行：GLM-5.3-Flash（产品负责人临时授权的 Integration/QA Agent）
- 日期：2026-09-09（本记录；前版 2026-09-08 的 35 PASS 记录已被真实浏览器结果推翻并作废）
- 结论：**REVIEW-BLOCKED —— 门如实 FAIL（44 PASS / 4 FAIL / 0 SKIP，退出码 1），required set COMPLETE（无 MISSING），清理 0 错误；REVIEW 未授予**。

发布路径已升级为**真实浏览器驱动**（合成 OIDC 拓扑 + 真实最终用户登录回环），目录可见性按产品负责人
既定的“严格诚实 FAIL”裁定：必须先经真实 UI 发布、再断言目录；发布负载缺 `modelAssetKey` 使成品不出现在
设计目录 → `flow/published-product-public` 与 `browser/approved-product-renders` **如实记 FAIL 并作为硬阻塞**，
直至一个前端任务让发布负载携带 `modelAssetKey`。另两条 FAIL 是**真实规模下暴露的 runtime 缺陷**
（Next 10 MiB 路由体上限、worker 自动分组重叠），同样如实记录。本任务未修改任何 runtime 代码，只修复 QA
脚本自身缺陷并补充证据；全部 FAIL 的修复归属于后续 runtime 任务（见“四、四 项 FAIL 与根因”）。

## 一、真实命令

工作目录：`.worktrees/asset-qa-001`。

说明：本机默认 `python3` 是被 `PYTHONHOME`/`PYTHONPATH` 污染的沙箱解释器（缺 requests），实际使用 Homebrew Python 3.11.15 并显式解污染：

```bash
# 1. 语法编译
env -u PYTHONHOME -u PYTHONPATH /opt/homebrew/bin/python3 -m py_compile scripts/ui-qa/bead_import_flow.py

# 2. 架构测试（8/8 通过；含 2026-09-09 review-fix 新增的 2 条回归不变式）
node --test tests/bead-asset-import-architecture.test.mjs

# 2b. 内建单元自检（不起服务/不建库/不开浏览器；验证 finish() 先 cleanup、后判定退出码）
env -u PYTHONHOME -u PYTHONPATH /opt/homebrew/bin/python3 -u scripts/ui-qa/bead_import_flow.py --self-test

# 3. 完整集成验收（真实浏览器 + 真实 OIDC 登录 + 真实后端 + 真实 worker + 一次性测试库）
env -u PYTHONHOME -u PYTHONPATH /opt/homebrew/bin/python3 -u scripts/ui-qa/bead_import_flow.py
```

最终通过的记录性运行（干净一次性，无 `--keep`）结果：

```
SUMMARY: 44 passed, 4 failed, 0 skipped; required set complete; cleanup errors: 0
RUN_EXIT=1
```

结束后数据库、全部子进程与临时目录均被清理（CLEANUP 日志逐项确认；测试库删除后经 `pg_database` 复核 absent）。

## 二、一次性测试数据库与环境

- 每次运行自动创建 `mystcrag_qa_flow_test_<unixtime>_<rand6>`（名称含 `test`），跑完 `DROP DATABASE ... WITH (FORCE)`。
- 本轮记录运行的测试库：`mystcrag_qa_flow_test_1788933801_f41c14`（已随脚本清理删除并复核 absent）。
- 认证：**合成 OIDC 拓扑** —— auth0 issuer 挂在 `synthetic.auth006.internal`；Node 预载
  `NODE_OPTIONS --require`；浏览器经 CONNECT relay 直达提供方；自签 CA 经 `NODE_EXTRA_CA_CERTS`；
  最终用户走真实 PKCE S256 authorize + redirect 回环（`browser/final-user-login` PASS）。管理台走独立
  admin key 门（`qa-integration-admin-key-0123456789`，合成值）。`.env` 未创建/修改。
- 归档根：临时目录（含后端 `archive/`、worker 日志、浏览器截图 desktop-*.png），运行前脚本显式 `mkdir`，结束后随清理删除（按治理要求不入库）。
- 脚本进程内强制 `no_proxy=*`：本机常驻外部代理会把 localhost 探活请求劫走返回 502。

## 三、逐项结果（记录性运行，`/tmp/qa001-final3.log`）

环境与服务 / 一次性库：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 1 | env/postgres | PASS | `psql -h /tmp` 可达 |
| 2 | fixtures/synthetic | PASS | 11 个合成文件：同 stem 对、跨目录同 stem、重复哈希、纯 jpg、纯 ARW、差背景 + 拯救片 |
| 3 | db/fresh-test-database | PASS | `mystcrag_qa_flow_test_1788933801_f41c14` |
| 4 | services/oidc-provider | PASS | provider tls `:64509`、admin `:64510`、relay `:64511`；discovery 经 CONNECT relay + 自签 CA 验证 |
| 5 | services/backend+worker | PASS | backend `:4100`；worker poll 1000ms |
| 6 | services/frontend | PASS | next dev `:64505`（默认端口被占用时自动改用临时端口） |

登录 / 建任务 / 上传 / 重启恢复：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 7 | browser/login+guard | PASS | guard 重定向到登录页；admin key 被接受进入管理台 |
| 8 | browser/create-session | PASS | 经 Dashboard 按钮真实创建会话（`cmttp014…`） |
| 9 | http/manifest | PASS | 11 文件登记（webkitdirectory 无法脚本化，经同源 BFF 端点完成，与页面网络面板一致） |
| 10 | http/upload | PASS | 10/11 上传；1 个扣下用于重启续传 |
| 11 | flow/sha256-archive-roundtrip | PASS | 每个 ARCHIVED 上传的归档副本 SHA-256 与源字节一致 |
| 12 | flow/restart-termination | PASS | backend 进程组 (pid 98827) 与 worker 进程组 (pid 98828) 被杀；4100 端口验证关闭 |
| 13 | flow/restart-new-pids | PASS | backend 98827→98977；worker 98828→98978 |
| 14 | flow/restart-resume | PASS | 会话与文件状态跨重启恢复（ARCHIVED/PENDING/SKIPPED_DUPLICATE） |
| 15 | flow/resume-upload-completes | PASS | 扣下的文件续传成功 |
| 16 | flow/resume-archive-settles | PASS | 归档结算后会话进入 ARCHIVING |
| 17 | flow/worker-advanced-after-restart | PASS | 重启后 worker 日志增长（19→115 字节），继续归档扣下的文件 |

分组 / 合并 / 拆分 / 命名：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 18 | browser/grouping-start | PASS | 从会话页真实点击按钮发起分组，BFF 返回 200（捕获 HTTP 响应） |
| 19 | flow/auto-grouping | PASS | 合成批次自动归出 5 组 |
| 20 | flow/merge | PASS | 5 → 4 组 |
| 21 | flow/split | PASS | 拆回 5 组（no-op split 视为失败） |
| 22 | flow/arw-only-merge | PASS | 纯 ARW 组并入含光栅组（操作员路径） |
| 23 | flow/primary-confirmed | PASS | 每组主文件均为人工确认的光栅 |
| 24 | browser/groups-page-render | PASS | 确认分组 panel 在真实浏览器渲染（desktop-03-groups.png） |
| 25 | flow/naming | PASS | 4 组人工命名（名称不来自图像/目录推断） |

草稿 / 目录可见性 / QC / 审批：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 26 | flow/draft | PASS | 经浏览器草稿表单保存；crystalDraftId `cmttp0f77000…` |
| 27 | flow/catalog-requires-auth | PASS | 匿名目录请求被 401 拒绝（protected route） |
| 28 | flow/draft-public-denial | PASS | 发布前草稿 SKU 不出现在认证目录 |
| 29 | flow/curation | PASS | 水晶八项 curation 字段人工填写并接受 |
| 30 | flow/draft-refresh-persistence | PASS | 刷新后 productDraft 从全新会话读取水合 |
| 31 | browser/draft-page-render | PASS | 命名与草稿 panel 在真实浏览器渲染（desktop-04-draft.png） |
| 32 | flow/processing-start | PASS | 经浏览器按钮启动处理 |
| 33 | flow/qc-verdict | PASS | 差背景版本 QC_FAILED（isCurrent=False） |
| 34 | flow/qc-blocks-approval | PASS | 对 QC_FAILED 请求审批被 409 拒绝；浏览器无审批表单 |
| 35 | flow/qc-recovery-reprocess | PASS | 操作员切换主文件到拯救片并 reprocess |
| 36 | flow/qc-recovery-passed | PASS | 拯救主片 v2 为 QC_PENDING |
| 37 | flow/human-approval | PASS | 全部组人工批准；返回权威 approvedAssetKey |
| 38 | browser/review-page-render | PASS | 处理、审核与发布 panel 在真实浏览器渲染（desktop-05-review.png） |

发布 / 公开渲染 / 目录可见性 / 视口：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 39 | flow/publish | PASS | 经真实浏览器发布表单（loader → BFF → backend）；`publishedAssetKeys=['approved:13f65529…c0ae8']`；inventory snapshot present |
| 40 | flow/public-approved-asset | PASS | 已批准 key 经公开 `/api/assets` 返回 200 `image/webp` |
| 41 | flow/published-product-public | **FAIL** | 真实 UI 发布后，成品不出现在认证设计目录（catalog 查询为空）——发布负载缺 `modelAssetKey`，目录 `materials()` 过滤要求其非空。见“四、根因 ①” |
| 42 | browser/final-user-login | PASS | 最终用户经真实合成 OIDC authorize + PKCE redirect 回环登录 |
| 43 | browser/approved-product-renders | **FAIL** | `/crystal-library` 上没有任何 `<img>` 引用已发布的 approved 资产——同根因①：珠子不在设计目录中，页面无图可渲染 |
| 44 | mobile/status-reviews-viewport | PASS | 390x844 无横向溢出（scrollWidth=390 clientWidth=390） |

真实素材只读导入（`/Users/chenyanyan/Desktop/珠子图`，127 文件 / 66 stem / 1 跨目录 stem / 1.32 GB）：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 45 | sources/discovery | PASS | 127 文件（65 JPG + 62 ARW）、66 stem、跨目录 stem `['ZDX01535']`、4 个 jpg-only stem、1 个 arw-only stem（只读枚举） |
| 46 | sources/proxy-large-body-cap | **FAIL** | 62/127 个真实文件（共 1,320,837,120 字节；首个 `ZDX01448.ARW` 21,190,656 字节）超出 Next 服务器默认 10 MiB 路由体上限，无法经管理代理上传（后端请求被截断永不完成、代理回 500）。见“四、根因 ②”。为保住归档/SHA/分组对每个真实文件的覆盖，这些 >10 MiB 文件改经**同一后端内容路由**直传——见第 47 项 |
| 47 | sources/import-roundtrip | PASS | 127 个真实文件**逐字节**归档进一次性库/临时归档（65 个 ≤10 MiB 经真实管理代理路径；62 个 >10 MiB ARW 经同一后端内容路由直传，代理上限已作为缺陷记于第 46 项）；权威 sha256 与源哈希逐一相符；6 个抽样归档文件复核逐字节一致 |
| 48 | sources/grouping-pairs | **FAIL** | 127 文件真实批次自动分组 240s 未收敛（`last=state=PARTIALLY_FAILED groups=0`）——worker 拒收分组成交。见“四、根因 ③” |

## 四、四项 FAIL 与根因（全部如实记录，硬阻塞，未在本任务修复）

| 根因 | FAIL 检查 | 证据 | 现象 | 修复归属 |
|---|---|---|---|---|
| ① 发布负载缺 `modelAssetKey` | flow/published-product-public；browser/approved-product-renders | 本条运行第 41/43 行；`apps/frontend/.../admin-bead-import/processing-loader.ts`（发布候选只带 `textureAssetKey`，无 `modelAssetKey`）；`design-api.service.ts` 目录 `materials()` 过滤丢弃 `modelAssetKey` 为空的行；仓库 `modelAssetKey ?? null` | 真实 UI 发布成功、`/api/assets` 200，但成品从认证目录与 `/crystal-library` 消失 | **前端任务**：让发布负载发送 `modelAssetKey=<已批准主图>`（与 `textureAssetKey` 同一已批准主图，后端显式支持的同资产路径）；修复后两条 FAIL 应变 PASS |
| ② Next 默认 10 MiB 路由体上限 | sources/proxy-large-body-cap | frontend.log `Request body exceeded 10MB … middlewareClientBodySize`；`next.config.ts` 无体积覆盖；解析后服务端配置 `proxyClientMaxBodySize: 10485760`（next-server 共享 body-clone 路径，非 dev 专属）；代理 500 “The bead import service did not respond.”；后端 Fastify 上限实为 256 MiB | 62 个 ~21 MB Sony ARW 无法经管理代理上传；后端与 worker 直连收 21 MB 完全正常 | **前端服务器配置任务**：上调路由体上限至 ≥256 MiB（或特征级每文件上限），使 ARW 可经代理走完整 BFF 链路 |
| ③ worker 自动分组在真实规模重叠 | sources/grouping-pairs | `/tmp/qa001-real-grouping-worker.log`、`/tmp/qa001-real-grouping-backend.log`（worker 拒收循环原文：`was rejected asset job completion result failed validation: groups.66.memberFileIds.*: A source file may belong to only one suggested group`）；会话终态 `PARTIALLY_FAILED groups=0` | 66 个真实 stem 的建议分组发生重叠（66 组建议中同一源文件被分到多组），worker 无限重试，会话卡死无任何可用分组 | **worker 任务**：分组完成结果校验/去重叠（或将重叠源文件归属唯一化），使真实规模批次能收敛出可用分组 |

“严格诚实”说明：第 41/43 两条按产品负责人裁定**不折算、不跳过**——成品目录可见性必须以真实 UI 发布为前置并如实断言；
正因为此诚实断言，① 号加载器缺陷才作为硬阻塞浮出。第 46 项是记录性缺陷（65 个 ≤10 MiB 文件已覆盖真实代理链路，
62 个 >10 MiB 文件为绕过服务器缺陷而直传同一后端路由，完整性覆盖不受损，但代理缺陷本身如实记 FAIL）。
第 48 项为真实规模下的 worker 缺陷；合成批次路径（第 18–23 项）全部通过，说明缺陷仅在 127 文件规模触发。

## 五、执行中发现并修复的脚本缺陷（仅改 QA 脚本与文档，未动 runtime）

1. **finish() 的 MISSING 重复计数**（本轮）：required 集里已如实给出 FAIL 的项同时被列进 MISSING，导致“required set INCOMPLETE”掩盖“已给出结论”的事实 → MISSING 仅统计“从头到尾未报告过任何结论”的必需项（已报告 PASS/FAIL/SKIP 均不计 MISSING）。
2. **真实目录自动分组超时不应终止整场**：分组改为独立可报告检查（`sources/grouping-pairs`），超时/拒收记 FAIL 并附会话终态，而非把后续导入判定一并带崩。
3. **>10 MiB 上传分层**：`http/upload` 主路径仍要求经真实代理（覆盖 BFF 链路）；超过 Next 10 MiB 上限的源文件改走同一后端内容路由并单独记为 `sources/proxy-large-body-cap` FAIL，保证归档/SHA/抽样仍覆盖每个真实文件。
4. 前几轮沿用并保留的修复：`archive_root` 只赋值未建目录 → 显式 `mkdir`；真实 `--skip-browser` HTTP 模式（浏览器项记 SKIP 不折算 PASS）；按实际结果分支、两次独立读取验证哈希；独立进程组 + cleanup SIGTERM 后无条件补 SIGKILL（曾留孤儿 next-server 持 Next 项目锁）；成功路径打印 SUMMARY 并清理；浏览器选择器用 `button:has-text` + `expect_response` 捕获真实 BFF 响应；目录断言认证化 + 匿名 401 断言；`no_proxy=*`；诊断探针去掉与 `.backend()` 冲突的 `timeout` 参数。
5. **2026-09-09 review-fix：`finish()` 先执行 cleanup、再冻结 problems / 打印 SUMMARY**（原 Important）：旧实现先冻结 `problems` 并打印 SUMMARY（恒为 “cleanup errors: 0”）再调 `cleanup()`，清理期新增的 `CLEANUP_ERRORS` 既不改变退出码、SUMMARY 也失真 → 改为先 `try: cleanup()`（异常同样记入 `CLEANUP_ERRORS`），再冻结 problems、打印 SUMMARY 并 `sys.exit`；任一清理错误必然 EXIT=1。记录性运行的 44P/4F/EXIT=1 结论不受影响（该轮清理确实 0 错误）。
6. **2026-09-09 review-fix：processing-start 的 `expect_response` 必须包住 click**（原 Important）：旧实现先 `click("启动处理")`、再挂 `expect_response` 监听，点击触发的 POST 响应可能先于监听就绪而到达并被漏捕获 → 改为把 click 放进 `with page.expect_response(...) as processing_start_info:` 块内触发，消除漏响应竞态（浏览器路径的业务判据不变：非 200 仍失败）。
7. **2026-09-09 review-fix 验证（未重跑 127 文件完整流程——本改动仅涉 QA 脚本/测试，业务结论不变）**：`py_compile` OK；`--self-test` PASS（模拟一次 cleanup 错误、业务全 PASS 且 required 集完整时，仍因该错误 EXIT=1、SUMMARY 报 “cleanup errors: 1”）；架构测试 8/8（新增 2 条回归不变式：cleanup() 文本序先于 problems 折叠 / SUMMARY / sys.exit；启动处理 click 文本序嵌套在 expect_response 块内）；`pnpm validate` 通过；`git diff --check` clean。

## 六、风险与建议

- **硬阻塞（发布类）**：在 ① 修复前，真实发布的产品对设计目录与 `/crystal-library` 不可见；这是前端 loader 的发布负载缺口，与后端正向接受路径无关。
- **规模缺陷**：② 影响任何 >10 MiB 的真实 ARW（本机桌面集 62/127 个）；③ 影响真实 127 文件整包自动分组，需 worker 侧修复后重跑 `sources/grouping-pairs` 期望转 PASS。
- 集成脚本依赖本机 Homebrew PostgreSQL（`psql -h /tmp`）与已安装的 pnpm 依赖，非 CI 可重放环境；前端 dev 冷启动偶发超 240 秒。
- 运行期间若脚本被强杀（kill -9），进程组兜底不会执行，可能留下孤儿 next-server 持有项目锁；下次运行前需手动清理。
- 记录性运行证据：`/tmp/qa001-final3.log`（完整输出，RUN_EXIT=1）；worker 拒收循环证据：`/tmp/qa001-real-grouping-worker.log`、`/tmp/qa001-real-grouping-backend.log`；`pnpm validate`：`/tmp/qa001-validate.log`。截图与归档均在一次性临时目录内、随清理删除，未入库（治理要求）。
- 本任务严格未修改 runtime 产品代码、契约、Prisma、根配置与 lockfile；改动限于 `scripts/ui-qa/bead_import_flow.py`、`tests/bead-asset-import-architecture.test.mjs`、本文档与 TASK_REGISTRY 本任务行。
