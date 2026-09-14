# Auth0 消费者访问验收记录（脱敏）

**任务：** TASK-AUTH-OPS-001
**分支：** task/auth-ops-001-consumer-access
**操作者：** DeepSeek V4 Pro（AUTH OPERATIONS）
**日期：** 2026-09-14
**总体状态：** BLOCKED（无真实 Auth0 tenant 授权访问）

> 事实状态分为三类：
> - `VERIFIED`：已授权并可核对，与证据一致。
> - `NOT_EXECUTED`：因权限或范围未执行，未声称通过。
> - `BLOCKED`：缺少真实 tenant 授权，无法读取或变更，不得伪造为租户事实。
>
> 本记录不记录 email、密码、cookie、token、code/state/nonce、client secret、原始 subject 或完整 authorize URL。

## 1. 授权访问检查（VERIFIED）

就仓库与本地工具层面核对，是否具备真实 Auth0 tenant 的已授权访问方式：

- 仓库 checked-in 模板 `.env.example` 中 `MYSTCRAG_AUTH_PROVIDER="signed-test"`，`MYSTCRAG_AUTH_CLIENT_ID` 与 `MYSTCRAG_AUTH_CLIENT_SECRET` 均为空 —— 这是仓库配置观察，不是 tenant 事实。
- 工作目录下无 `.env` 真实凭据文件。
- 未安装 `auth0` CLI，不存在 `~/.config/auth0` 配置目录。
- 当前 shell 环境无 `AUTH0_*` 或 `MYSTCRAG_AUTH_*` 的真实 tenant 变量。
- 无已授权的 Auth0 Management API 凭据、Dashboard 会话或 MCP 连接可安全使用。

结论：**不存在真实 Auth0 tenant 的已授权访问方式**。因此无法读取或变更租户配置，也无法执行真实注册/登录/登出冒烟。

## 2. 租户配置核验（BLOCKED）

因无 tenant 访问，下列批准方向的配置均无法核对或变更，全部为 `BLOCKED`；不记录任何具体环境标签、应用名、连接名、UTC 时间或布尔值，以免把推测写成租户事实。

| 配置项 | 批准方向 | 状态 |
| --- | --- | --- |
| 现有数据库连接已绑定应用 | 启用 | BLOCKED |
| Disable Sign Ups | 关闭（允许公开注册） | BLOCKED |
| 标识类型 | 邮箱 + 密码 | BLOCKED |
| Verify email on sign up | 关闭（MVP 免验证） | BLOCKED |
| SMS / voice / email OTP / passwordless | 禁用 | BLOCKED |
| 密码策略 | 保持 Auth0 自身策略，不复用管理后台“长度大于 5”规则 | BLOCKED |
| callback / logout / web origin | 精确环境 allowlist，无通配符 | BLOCKED |

## 3. 真实注册 / 登录 / 登出（NOT_EXECUTED / BLOCKED）

- 创建测试用户：`NOT_EXECUTED` —— 属于受限外部账号变更，任何情况下都不得由本执行者自行执行，需用户确认。
- 提交注册表单：`NOT_EXECUTED`。
- 登录流程（免 OTP 门槛 → 回到原相对地址）：`NOT_EXECUTED`。
- 真实 POST 登出后再登录：`NOT_EXECUTED`。
- 删除测试用户：`NOT_EXECUTED` —— 同样需明确确认。

以上均因无 tenant 访问而无法取得真实证据，未声称通过。

## 4. 已完成交付物（VERIFIED）

- `docs/LOCAL_DEMO_GUIDE.md` 新增“桌面身份失效与恢复”一节（第 9 节），描述保持原标签页、启动器正常停启、重新生成长达 8 小时的服务端 token、等待健康、回原相对 URL 重试，并明确浏览器刷新/登录按钮无法修复、浏览器不得生成 token、内存草稿仅原标签页保持打开时可能保留。
- 本验收记录创建完成，未录入任何秘密或敏感字段。

## 5. 解除 BLOCKED 所需权限

满足任一条件后可由 Codex 重新登记或授权复核：

1. 获得真实 Auth0 tenant 的 Dashboard 或 Management API 已授权访问，允许读取并变更目标 Application 与 Database Connection；
2. 或由 tenant 所有者提供经授权的脱敏导出（仅环境标签、应用名、连接名、布尔配置、UTC 时间，不含秘密）。

## 6. 最终动作与用户确认

若后续获得真实 tenant 权限，以下动作仍须在执行前取得用户明确确认，不得自行执行：

- 创建测试用户并提交注册表单；
- 删除测试用户或任何其他外部账号变更。

## 7. 契约差异提示（超出本任务授权范围）

`docs/AUTH_SESSION_CONTRACT.md` 第 12 节称桌面 Access Token“仅存在于启动器 `0600` runtime env 与 Next.js 服务端进程内存”。实测启动器生成的 `0600` 权限 `runtime-env.sh` 会被 Frontend 与 Backend 两个 LaunchAgent 共同 source，两个服务进程均继承 token；仅 Frontend 认证代码消费并以 server-to-server `Authorization: Bearer` 转发，Backend 仅校验请求中的 token。该契约表述与实现存在偏差，可能需要另立 contract / launcher remediation 任务核对；本任务无权修改该文件。
