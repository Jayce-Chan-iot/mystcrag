# TASK-ASSET-QA-001 — 珠子素材入库集成验收记录

- 任务：`TASK-ASSET-QA-001`（一次性集成 / 架构 / 本地验收门，计划 Task 7）
- 分支：`task/asset-qa-001-integration-gate`（worktree `.worktrees/asset-qa-001`，基线 `6e79b66`）
- 执行：GLM-5.3-Flash（产品负责人 2026-09-08 临时授权的 Integration/QA Agent）
- 日期：2026-09-08
- 结论：**通过（35 PASS / 0 FAIL / 1 SKIP——SKIP 为如实记录的环境边界，未折算为 PASS）**

## 一、真实命令

工作目录：`.worktrees/asset-qa-001`。

说明：本机默认 `python3` 是被 `PYTHONHOME`/`PYTHONPATH` 污染的沙箱解释器（缺 requests），实际使用 Homebrew Python 3.11.15 并显式解污染：

```bash
# 1. 语法编译
env -u PYTHONHOME -u PYTHONPATH /opt/homebrew/bin/python3 -m py_compile scripts/ui-qa/bead_import_flow.py

# 2. 架构测试（6/6 通过）
node --test tests/bead-asset-import-architecture.test.mjs

# 3. 完整集成验收（真实浏览器 + 真实后端 + 真实 worker + 一次性测试库）
env -u PYTHONHOME -u PYTHONPATH /opt/homebrew/bin/python3 scripts/ui-qa/bead_import_flow.py
```

结果：`SUMMARY: 35 passed, 0 failed, 1 skipped`，退出码 0；结束后数据库、全部子进程与临时目录均被清理（CLEANUP 日志逐项确认）。

## 二、一次性测试数据库与环境

- 每次运行自动创建 `mystcrag_qa_flow_test_<unixtime>_<rand6>`（名称含 `test`），跑完 `DROP DATABASE ... WITH (FORCE)`。
- 本轮最终通过运行的测试库：`mystcrag_qa_flow_test_1788876924_c4e0ad`（已随脚本清理删除）。
- 认证：后端 `MYSTCRAG_AUTH_PROVIDER=signed-test`（本地 HMAC 合成令牌，仅注入子进程环境，未创建/修改 `.env`，无真实凭据）；管理台走独立 admin key 门（`qa-integration-admin-key-0123456789`，同为合成值）；前端为合成 auth0 形态配置（不演练最终用户登录）。
- 归档根：临时目录 `archive/`，运行前脚本显式 `mkdir`（runtime 要求目录预先存在）。
- 脚本进程内强制 `no_proxy=*`：本机常驻外部代理（`HTTP_PROXY=127.0.0.1:7897`）会把 localhost 探活请求劫走返回 502。

## 三、逐项结果（最终通过运行）

环境与服务：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 1 | env/postgres | PASS | `psql -h /tmp` 可达 |
| 2 | fixtures/synthetic | PASS | 11 个合成文件：同 stem 对、跨目录同 stem、重复哈希、纯 jpg、纯 ARW、差背景 + 拯救片 |
| 3 | db/fresh-test-database | PASS | 全新一次性测试库 |
| 4 | services/backend+worker | PASS | backend :4100；worker poll 1000ms |
| 5 | services/frontend | PASS | next dev（默认端口被占用时自动改用临时端口） |

登录 / 建任务 / 上传 / 重启恢复：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 6 | browser/login+guard | PASS | 未登录被重定向到登录页；key 被接受进入管理台 |
| 7 | browser/create-session | PASS | 经 Dashboard 按钮真实创建会话 |
| 8 | http/manifest | PASS | 11 文件登记（浏览器 webkitdirectory 无法脚本化，经同一 BFF 端点完成，与页面网络面板所见一致） |
| 9 | http/upload | PASS | 10/11 上传；1 个扣下用于重启续传 |
| 10 | flow/sha256-archive-roundtrip | PASS | 每个 ARCHIVED 上传的归档副本 SHA-256 与源字节一致 |
| 11 | flow/restart-resume | PASS | 杀后端+worker 再重启；会话与文件状态恢复（ARCHIVED/PENDING/SKIPPED_DUPLICATE） |
| 12 | flow/resume-upload-completes | PASS | 扣下的文件续传成功 |
| 13 | flow/resume-archive-settles | PASS | 归档结算后会话进入 ARCHIVING |

分组 / 合并 / 拆分 / 命名：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 14 | browser/grouping-start | PASS | 从会话页真实点击按钮发起分组，BFF 返回 200（并捕获 HTTP 响应，非仅点击成功） |
| 15 | flow/auto-grouping | PASS | 合成批次自动归出 5 组 |
| 16 | flow/merge | PASS | MERGE_GROUPS 5 → 4 组 |
| 17 | flow/split | PASS | 拆回 5 组 |
| 18 | flow/arw-only-merge | PASS | 纯 ARW 组并入含光栅组（操作员路径） |
| 19 | flow/primary-confirmed | PASS | 每组主文件均为人工确认的光栅 |
| 20 | flow/naming | PASS | 4 组人工命名（名称不来自图像/目录推断） |

草稿 / 目录可见性 / QC / 审批：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 21 | flow/catalog-requires-auth | PASS | 匿名目录请求被 401 拒绝（目录是 protected route，非匿名公开端点） |
| 22 | flow/draft-public-denial | PASS | 发布前草稿 SKU 不出现在认证目录 |
| 23 | flow/curation | PASS | 水晶八项 curation 字段人工填写并接受 |
| 24 | flow/draft-refresh-persistence | PASS | 刷新后 productDraft 从全新会话读取水合 |
| 25 | flow/qc-verdict | PASS | 差背景版本 QC_FAILED（isCurrent=False） |
| 26 | flow/qc-blocks-approval | PASS | 对 QC_FAILED 资产请求审批被 409 拒绝 |
| 27 | flow/qc-recovery-reprocess | PASS | 操作员切换主文件到拯救片并 reprocess |
| 28 | flow/qc-recovery-passed | PASS | 拯救主片 v2 为 QC_PENDING |
| 29 | flow/human-approval | PASS | 全部组人工批准；返回权威 approvedAssetKey |

发布 / 公开渲染 / 视口：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 30 | flow/publish | PASS | publishedAssetKeys 与审批一致；inventory snapshot 存在 |
| 31 | flow/public-approved-asset | PASS | 已批准 key 经公开 `/api/assets` 返回 200 `image/webp` |
| 32 | flow/published-product-public | PASS | 已发布产品出现在认证目录（protected route 视图） |
| 33 | browser/approved-product-renders | **SKIP** | 环境边界，见下节 |
| 34 | mobile/status-reviews-viewport | PASS | 390x844 无横向溢出（scrollWidth=390 clientWidth=390） |

真实素材只读探测：

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 35 | sources/discovery | PASS | 只读探测 `/Users/chenyanyan/Desktop/珠子图`：26 目录 / 127 文件（原样记录） |
| 36 | sources/hash-consistency | PASS | 5 个样本各独立读取两次、SHA-256 一致（只读子进程分块读取，绝不写入/复制/移动）；无法抽样时按实际结果记 BLOCKED，不标 PASS |

## 四、环境阻塞与边界（如实声明，非通过项）

1. **`browser/approved-product-renders` SKIP**：`crystal-library` 页面数据源 `designApi.materials` 走 `/api/catalog/materials`（前端 BFF 以最终用户 Auth0 会话转发）。本验收的合成 auth0 配置无法完成真实 OAuth 回环，浏览器中没有最终用户会话，页面停在认证门槛——已发布珠子的浏览器端渲染无法在本环境断言。目录数据本身已由第 32 项（认证目录查询）断言。
2. **webkitdirectory 无法被 Playwright 脚本化**：manifest 登记与文件字节上传改用浏览器登录后的同一同源 Cookie，经前端 BFF 代理的同一批端点完成（与页面网络面板所见一致）；其余流程均由真实浏览器驱动。
3. **目录不是匿名公开端点**：`/api/catalog/materials` 为 `protectedRoute`。验收以 signed-test 认证身份查询目录（登录用户视图），并单独断言匿名请求被 401 拒绝。
4. **已知 API 缺口（继承自前端任务记录，未在本任务修复）**：无未发布处理图/缩略图的管理员受权读取接口；`AssetImportSessionResponse.processedAssets` 不提供发布用权威 `textureAssetKey`（本流程经审批响应取回）。

## 五、执行中发现并修复的脚本缺陷（仅改 QA 脚本，未动 runtime）

1. `archive_root` 只赋值未创建目录 → 启动服务前显式 `mkdir`。
2. `--skip-browser` 声明未使用 → 实现为 HTTP 层模式（浏览器专属断言记 SKIP，不折算 PASS）。
3. `run_source_set_phase` 固定声称“文件提供器阻塞” → 按实际结果分支，真实抽样两次独立读取验证哈希。
4. 进程清理只 SIGTERM 直接子进程，pnpm→next dev→next-server 孙进程链留孤儿（孤儿持有 Next 项目锁，令后续运行的 `next dev` 拒绝启动）→ `start_new_session` 独立进程组 + cleanup `killpg` SIGTERM 后无条件补 SIGKILL。
5. 成功路径不打印 SUMMARY、不清理 → `main()` 成功后同样调用 `finish()`。
6. 浏览器选择器 `text=开始自动分组` 命中无事件绑定的卡片标题 `<p>`（点击“成功”但从不发请求）→ 改为 `button:has-text(...)` 并用 `expect_response` 捕获真实 BFF 响应。
7. 目录断言未认证（401 空列表静默失真）→ 匿名 401 断言 + signed-test 认证目录查询。
8. 本机外部代理劫持 localhost 探活 → 脚本内 `no_proxy=*`。
9. 发布请求补 `modelAssetKey`（目录完整性过滤要求非空；同一已批准主图同时充当模型引用是后端显式支持的同资产路径）。

## 六、风险与建议

- 集成脚本依赖本机 Homebrew PostgreSQL（`psql -h /tmp`）与已安装的 pnpm 依赖，非 CI 可重放环境；后续如需 CI 化需先解决服务编排。
- 前端 dev server 冷启动偶发超过 240 秒（Turbopack 编译 + 磁盘忙），脚本以 240 秒为上限；若复现可加大 `wait_for_http` 超时。
- 运行期间若脚本被强杀（kill -9），进程组兜底不会执行，可能留下孤儿 next-server 持有项目锁；下次运行前需手动清理（`pgrep -fl "next dev -p"`）。
- 本任务严格未修改 runtime 产品代码、契约、Prisma、根配置与 lockfile；上述全部改动限于 `scripts/ui-qa/bead_import_flow.py`、`tests/bead-asset-import-architecture.test.mjs`、本文档与 TASK_REGISTRY 本任务行。
