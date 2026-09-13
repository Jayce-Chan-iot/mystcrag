# 消费者登录注册与桌面身份恢复规格

**状态：** PRODUCT OWNER DIRECTION APPROVED，待规格复核  
**日期：** 2026-09-13  
**规划任务：** TASK-UX-AUTH-001  
**关联功能：** FEAT-018 Authentication and user identity

## 1. 现象与根因

普通未登录流程显示“登录后继续”弹窗，但当前桌面脚本模式中的 `/auth/login` 按既有契约只执行同源 303 返回。因此桌面身份过期、前后端凭证不同步或误报 401 时，点击“登录 / 注册”会回到原页面，看起来没有任何反应。

“暂不登录”必须只关闭弹窗并保留当前表单、路由和滚动位置。如果关闭后出现上一页内容，必须证明是当前业务组件自身的状态回退，而不是把关闭动作连接到 retry、router.back 或重新提交。

## 2. 身份架构决策

生产和普通 Web 开发模式继续使用 Auth0 Universal Login。不得新增本地消费者密码表、密码散列、第二套 Cookie Session，也不得复用管理后台的 `admin/admin`。

现有权威保持不变：

- 浏览器会话：Auth0 SDK 加密 HttpOnly Cookie；
- 后端认证：短期 Access Token 经 `AuthenticatedActorProvider` 验证；
- 用户落库：`ExternalIdentityRepository.findOrProvisionExternalIdentity`；
- 数据模型：内部 `User.id` 与唯一 `(issuer, subject)` 的 `ExternalIdentity`；
- provider subject、Access Token 和密码不得写入业务用户字段。

## 3. 普通用户登录与注册

未登录用户点击主按钮必须导航到 `/auth/login?returnTo=<当前相对地址>`，再收到 Auth0 `/authorize` 重定向并进入 Universal Login。登录页同时提供登录和注册，不在玄矶应用内伪造密码表单。

Auth0 数据库连接的部署设置为：

- `Disable Sign Ups` 关闭，使公开注册可用；
- 使用邮箱和密码，不启用短信、语音或邮箱 OTP；
- MVP 阶段关闭 `Verify email on sign up`，注册后不以邮箱验证作为进入应用的前置条件；
- 密码强度仍由 Auth0 数据库连接策略控制，应用不得将此前管理后台的“长度大于 5”规则套用到消费者密码；
- 回调、登出和 Web Origin 继续使用环境隔离的精确 allowlist。

以上是 Auth0 tenant 配置，不通过 Prisma 或前端代码模拟。实施任务必须把操作步骤写入部署文档，并在无法访问真实 tenant 时明确标记为运维待执行，不能伪报已经启用。

官方配置依据：

- https://auth0.com/docs/authenticate/database-connections/custom-db/create-db-connection
- https://auth0.com/docs/authenticate/database-connections/activate-and-configure-attributes-for-flexible-identifiers
- https://auth0.com/docs/authenticate/connection-settings-best-practices

## 4. 用户数据落库

Auth0 登录成功建立浏览器会话后，用户第一次访问受保护 Backend API 时，现有认证前置处理器必须原子执行身份映射：

1. 用规范化的 `issuer + subject` 查询 `ExternalIdentity`；
2. 不存在时在同一事务创建空白 `User` 和对应 `ExternalIdentity`；
3. 保存经过验证器投影的 email、`emailVerified` 和 displayName 提示；
4. `emailVerified=false` 是合法的 MVP 状态，不得阻止身份创建或 DIY 访问；
5. 并发首次请求只能产生一个外部身份和一个内部 actor；
6. 后续登录更新资料提示，但内部 `User.id` 保持稳定。

消费者密码仍只由 Auth0 保存。玄矶数据库不保存密码、验证码、授权码、PKCE verifier、Access Token 或 Refresh Token。

## 5. 桌面脚本模式

桌面脚本的 signed-test 自动身份用于本机演示，不是消费者注册方式。正常情况下 `/auth/session` 已返回 `authenticated:true`，受保护操作不应出现登录弹窗。

如果桌面会话投影为已登录但 Backend 返回 401，前端必须把它识别为“本地演示身份失效或不同步”，不能展示会原路返回的普通登录按钮。恢复动作必须：

- 清楚提示用户重新启动桌面脚本以生成新的最长 8 小时 Token；
- 保留当前路由和未提交的浏览器内表单状态；
- 不把 Token 暴露到客户端，不在浏览器生成 signed-test Token；
- 不自动切换到 Auth0，也不把固定演示用户当成普通注册用户；
- 重启后回到原相对地址，并允许重新执行受保护操作。

若产品以后需要在同一个本地进程中主动切换到 Auth0，必须另立身份模式切换任务；本规格不引入双会话优先级。

## 6. 弹窗行为

- Auth0 模式：主按钮进入 Universal Login；次按钮、Escape 和遮罩只关闭弹窗。
- Desktop 模式身份异常：主动作改为明确的本地恢复指引，不渲染无效登录链接。
- 关闭不得调用 `router.back()`、业务 retry、重新提交或清空用户输入。
- 返回登录前的 `returnTo` 保留 pathname、query 和 hash；服务端继续拒绝外部 URL、双斜杠、反斜杠与编码绕过。
- 焦点进入主动作，Tab 不逃逸，关闭后回到触发控件；移动端按钮不小于 44px。

## 7. 任务拆分

后续实现拆为依赖顺序明确的任务：

1. AUTH/FRONTEND 任务修复模式感知的弹窗与真实登录导航，并补充浏览器行为测试。
2. AUTH/OPERATIONS 任务补充 Auth0 数据库连接注册、免验证 MVP 配置和桌面身份恢复运行手册。
3. DATABASE/BACKEND QA 任务只验证既有首次身份映射在 `emailVerified=false` 下仍正确落库；只有测试证明实现有缺口时才允许改数据库或后端。

不得在没有红色回归测试的情况下修改 Prisma schema、迁移或身份仓库。

## 8. 验收矩阵

- Auth0 未登录：点击“登录 / 注册”得到真实 Auth0 authorize 重定向，完成注册后回到原页面。
- 注册无需邮箱或手机号验证码即可进入 MVP；Auth0 tenant 操作证据真实可核对。
- 首个受保护 API 请求创建且只创建一个 `User` 和一个 `ExternalIdentity`，`emailVerified=false` 不被拒绝。
- 再次登录保持同一内部 actor，设计、塔罗、作品和订单归属不漂移。
- “暂不登录”只关闭弹窗，当前表单与路由不变；再次触发 401 时弹窗可重新打开。
- 桌面自动身份正常时不显示弹窗；Token 异常时显示可执行恢复信息而不是无效登录链接。
- Auth0 Cookie、Token、subject、内部 actorId 和密码不进入 URL、HTML、客户端状态、日志或 Prisma 非身份字段。
- Frontend、Backend Auth、Database identity 集成测试及安全边界测试通过；`pnpm validate` 的既有过期 community 测试问题必须单列，不能记为本任务通过。

