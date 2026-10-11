# Medusa 干净安装门槛：TASK-COMMERCE-MEDUSA-INSTALL-001

日期：2026-10-11。唯一执行 owner：CODEX（用户同意在 TRAE CN / DeepSeek 会话无法启动后由 Codex 代跑）；SOL 负责独立审查。本任务分支为 `task/commerce-medusa-install-001-clean-install-gate`，专用工作树为 `/Users/chenyanyan/.codex/worktrees/commerce-medusa-install-001/玄矶水晶DIY设计网页端`。Task 1 `TASK-COMMERCE-MEDUSA-BASE-001` 仍为 **REVIEW**，本安装门槛不将它置为 DONE，也不解锁 Contract Task 2。

登记提交：`a0dd14ac8590902787d0d32b7058acfad30d3dbb`；基线：`f774ab97fde8b33afe9314c0b501c459ebc7f2c7`；已验证配置提交：`fa1e47f68edb5acaa19cb30d4b6714fd54cf56b4`。配置只改了 [pnpm-workspace.yaml](../../pnpm-workspace.yaml) 的下列四个 `allowBuilds` 值；[pnpm-lock.yaml](../../pnpm-lock.yaml) 未改，其他包的构建策略、`overrides` 和发布等待设置均保留。四项并非因为安装报错而一概放行：逐项评估后均明确**拒绝其安装期脚本**，并分别验证所需运行能力。

## 锁定来源和逐项决策

版本及完整性来自现有 `pnpm-lock.yaml`；依赖链由隔离检出中的 `pnpm --filter @mystcrag/commerce why <package> --depth 12` 确认。脚本及调用文件来自此次锁定安装的包内容，而非猜测。

| 包 | 锁定版本和 SHA-512 integrity | 依赖来源 | lifecycle、行为与决定 |
| --- | --- | --- | --- |
| `@medusajs/telemetry` | `2.21.2`；`sha512-3tzUxWVJ0knLEuKtrHxLQbiAG2O/BV+1Dj3ZjUrUpgf4xGF3PMeKutWL+YdWASWNgQnuAo6WvxREnLh5bZob0w==` | `@medusajs/cli`、`@medusajs/framework`、`@medusajs/medusa` → commerce。 | `postinstall: node dist/postinstall.js \|\| true`。`dist/postinstall.js` 实例化 `dist/store.js`，后者尝试以 `configstore("medusa", {}, {globalConfigPath:true})` 读取用户级配置、构造 outbox 路径，并检查 `telemetry.enabled`；非 CI、未禁用时可能输出通知。脚本无显式网络调用、无编译或下载，但允许它会触碰用户级遥测配置且失败被 `\|\| true` 掩盖。安装不需要这个通知，决定 `false`。禁用脚本后，commerce 探针中的 Medusa CLI 迁移、冷启动和重启均成功；最终探针另设 `MEDUSA_DISABLE_TELEMETRY=true`，不使用外部遥测。 |
| `@swc/core` | `1.16.13`；`sha512-k4uUsIMS0IwOKVsrQs48IZK75O4roV3FnuJEdL7ES+DFESftdgvz73QBqN3VUAbUmUr78We4tzG0kgYj36M22Q==` | commerce 的直接 devDependency，也由 `@medusajs/medusa` 和 `ts-node` 引入。 | `postinstall: node postinstall.js`。先加载 `binding.js` 验证原生目标；若缺失，使用 `npm install --no-save ... @swc/wasm@<version>` 在包内临时目录发起二次依赖解析/可能联网，再移动到 `INIT_CWD/node_modules/@swc/wasm`。已锁定的平台原生可选包在本机可直接加载，无需安装脚本的非锁定回退，决定 `false`。禁用后执行真实 SWC TypeScript transform，commerce typecheck、Medusa 启动及全仓 build 通过。此决定仅证明本次 macOS arm64/Node 26 验证环境；其他平台须单独复验原生二进制可用性。 |
| `msgpackr-extract` | `3.0.4`；`sha512-4kmO/MdyUIkLIvTPr8VHLil4AtoKIoniWPIEk5+CDy0xnWC84azhSFmuJ7PxZdsYtiP5kEeQsORAVIeMgxT+Hw==` | `msgpackr` → `bullmq` → Medusa Redis event/workflow 模块 → commerce。 | `install: node-gyp-build-optional-packages`。`node-gyp-build-optional-packages@5.2.2/bin.js` 先测试可选预构建原生包；测试失败或强制源码构建时调用 `node-gyp rebuild`，会写本地产物并可能为编译获取工具链/头文件。`msgpackr/node-index.js` 把 extractor 的加载包在 `try/catch` 中，注释明确 native module optional；因此决定 `false`。在实际安装中 pack/unpack 通过，且设置 `MSGPACKR_NATIVE_ACCELERATION_DISABLED=true` 的纯 JS 回退单测也通过；不声称其性能等同原生加速。 |
| `protobufjs` | `7.6.6`；`sha512-dYDWdjSl5RNb7SgPxGQcRU+GtvP7s2fpkrY0r432PcOIaZ0/rBcxEZnQN67iJhFuQiVw754JDoPruPCNdGsbjg==` | `@grpc/proto-loader` → `@grpc/grpc-js` → OpenTelemetry OTLP gRPC → `@medusajs/deps` → commerce。 | `postinstall: node scripts/postinstall`，实际文件 `scripts/postinstall.js`；读取自身及上层 `package.json`，按 `versionScheme` 检查版本前缀并可能向 stderr 提示。无显式下载、编译或网络调用，也不生成运行时资源；这里无需安装期诊断，决定 `false`。禁用后实际 protobuf Type encode/decode 通过，全仓测试及 commerce 冷启动通过。 |

没有关闭 pnpm 的严格构建门、没有使用 `--ignore-scripts`，也没有改锁文件、清单、源码或其他构建白名单项。`false` 只抑制对应四包的 lifecycle；已允许的 Prisma engines、Prisma、sharp、esbuild、unrs-resolver 等脚本及仓库 `postinstall` 仍按现有配置执行。新平台或上述依赖升级时应重新逐项评估，不能把本机结论外推为所有平台已验证。

## 全新隔离安装与复验

检出目录：`/tmp/mystcrag-medusa-install-001.YougV0/checkout`；从本任务分支对 `fa1e47f68edb5acaa19cb30d4b6714fd54cf56b4` 执行 `git clone --no-local --branch task/commerce-medusa-install-001-clean-install-gate --single-branch`，克隆时无 `node_modules`、生成 Prisma client 或 `.env`，工作树干净。空 store：`/tmp/mystcrag-medusa-install-001.YougV0/store`。Node `26.0.0`、pnpm `11.4.0`；满足仓库 `>=22` 和 commerce `>=22.22.0` 的声明。下列命令均在该检出运行；安装、测试、探针和 validate 启动前解除 `DATABASE_URL`、`TEST_DATABASE_URL`、`COMMERCE_DATABASE_URL`、`MEDUSA_DATABASE_URL`、`PGHOST`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`。没有配置真实数据库凭据；安装期只运行现有 `pnpm db:generate`，未迁移/seed/reset 或连接真实数据库。

| 门槛 | 命令与结果 | 原始日志 |
| --- | --- | --- |
| 全新冻结安装 | `pnpm install --frozen-lockfile --store-dir /tmp/mystcrag-medusa-install-001.YougV0/store`，退出 `0`；20 个 workspace project，从空 store 下载 1702 包、共新增 1707 包，耗时 4m47.8s；无四包 lifecycle 执行、无 ignored-build 错误。安装前后锁文件 SHA-256 均为 `168cebb00622abea72ec8095e29ddea8141ea2c36e24c43d3aa542c1d4dc559f`。 | `/tmp/mystcrag-medusa-install-001.YougV0/install.log`，SHA-256 `d973f8603b0a77d7423b7f31f10877de56c7377361d060710c2cc34d09acbea6` |
| commerce 定向测试 | `pnpm --filter @mystcrag/commerce test`，24/24 PASS、退出 `0`。 | `/tmp/mystcrag-medusa-install-001.YougV0/commerce-test.log`，SHA-256 `fbf1b8d9c5bfc2146d18fcde7bae79656bb0d1f1261d3a70f204a69be1bf2c9a` |
| commerce 类型检查 | `pnpm --filter @mystcrag/commerce typecheck`，`tsc --noEmit` 退出 `0`。 | `/tmp/mystcrag-medusa-install-001.YougV0/commerce-typecheck.log`，SHA-256 `8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92` |
| 拒绝脚本后的能力复验 | SWC `transformSync`、msgpackr pack/unpack、protobufjs Type encode/decode 均 PASS，退出 `0`；另设 `MSGPACKR_NATIVE_ACCELERATION_DISABLED=true` 的 pack/unpack 回退 PASS，退出 `0`。 | `/tmp/mystcrag-medusa-install-001.YougV0/runtime-capabilities.log`，SHA-256 `999832265e4d30e9ed44c5eeeaaec01422bca28c73a30ee26dac61bed627b3d4`；`/tmp/mystcrag-medusa-install-001.YougV0/msgpackr-fallback.log`，SHA-256 `c796e14229f2e6172c47472552e218008867b75227cef6a5d178cf47bc3e6540` |
| 架构 | `node --test tests/architecture.test.mjs`，23/23 PASS、退出 `0`。 | `/tmp/mystcrag-medusa-install-001.YougV0/architecture.log`，SHA-256 `e098cbb732e270f04d798ce1c2c09e702e32124941df5c70acce66bf1284cd1d` |
| 工作区校验 | `CI=1 pnpm validate`，退出 `0`；lint 19/19、typecheck 19/19、test 19/19、build 18/18，四阶段缓存均 0。根测试输出 82/82 PASS；有明确环境门控 skip 的模块测试不改写为“全量执行”。 | `/tmp/mystcrag-medusa-install-001.YougV0/validate.log`，SHA-256 `b74816a6362a5844a28349d9767da5ab9fe453c145544a8d9e683784ba0517af` |

隔离探针 `MEDUSA_DISABLE_TELEMETRY=true COMMERCE_PROBE_EVIDENCE_DIR=/tmp/mystcrag-medusa-install-001.YougV0/probe-evidence-final pnpm --filter @mystcrag/commerce probe:isolation` 退出 `0`，在系统临时目录创建抛弃式 PostgreSQL 集群与独立 role/database；不接触真实数据库、遥测服务或品牌数据。其现有脚本实际检查：缺失/共享/别名/查询覆盖/百分号编码/无效 URL 和本地 `.env` 两种 dotenv 声明均失败关闭；隔离库迁移 151 表且均属专用 role；冷启动及重启 `/health` 成功、仅 `127.0.0.1` 监听且非 loopback TCP 拒绝；虚构商品/集合在 CN/CNY 与 TW/TWD 两个区域返回人工价格并在重启后保留；canary 用户库始终零表、零意外会话；服务进程及临时 PostgreSQL 已停止（脚本保留临时集群目录供检查）。原始日志 `/tmp/mystcrag-medusa-install-001.YougV0/isolation-probe-final.log` 的 SHA-256 为 `c72e42008119226e5cef16b01ef722188270c4b9391bec9e13cd8fb73a4279e5`；探针自有证据 `/tmp/mystcrag-medusa-install-001.YougV0/probe-evidence-final/probe-isolation.log` 的 SHA-256 为 `a44ff4db1e82410e90b5885a3b9d33029e6e781856666f4a21b36042c0980077`。临时集群路径 `/var/folders/3p/m0k1zjwn22gdsdbv83g0z6nr0000gn/T/mystcrag-commerce-base-001-mSiyTC`，进程已退出，目录仅供审查。

环境边界：安装时出现 npm registry 下载缓慢/重试警告，但最终退出 `0`；Prisma `7.9.0` 的 preinstall 在 Node 26 上打印其支持范围 `20.19+ / 22.12+ / 24.0+` 警告，仍完成 client 生成。此处只证明当前 Node 26 环境的门槛通过，不宣称该警告已消失或代表 Prisma 对 Node 26 的正式支持。

## 交付复核

文档内三个仓库相对链接及所述 commerce 探针源码路径逐一检查存在；隔离检出安装和验证后 `git status --short` 为空、锁文件哈希不变。交付分支相对基线的变更限定为 [任务注册表](../tasks/TASK_REGISTRY.md)、[pnpm-workspace.yaml](../../pnpm-workspace.yaml) 及本文档；`git diff --check` 必须为零告警，交付 SHA 以最终提交对象为准。原始日志只存于上述临时目录，不纳入仓库；已验证配置提交 `fa1e47f68edb5acaa19cb30d4b6714fd54cf56b4` 不会因本证据文档提交而重写。没有合并、推送、部署或修改其他任务的受控路径。
