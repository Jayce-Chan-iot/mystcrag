# TASK-AUTH-009 登录提示与桌面自动开发身份设计

**状态：** APPROVED BY PRODUCT OWNER

**日期：** 2026-09-12

**负责人：** GLM-5.3 实现，Codex 主导、复审与合并

**关联功能：** FEAT-018 Authentication and user identity

## 1. 问题与目标

当前消费者页面在没有 Auth0 会话时，受保护接口返回 `401 UNAUTHORIZED`，界面只显示“需要验证开发会话”，普通用户不知道如何登录或注册。桌面启动脚本虽然会生成 signed-test Access Token，但把它写入已废弃且禁止消费的 `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN`；BFF 仍只读取 Auth0 Cookie Session，因此本地脚本启动后无法完成抽牌、保存设计等受保护操作。

本任务同时解决两个边界明确的问题：

1. 普通网页用户在受保护操作遇到 401 时看到清晰、可访问的登录/注册弹窗，并由本人决定是否前往 Auth0 Universal Login。
2. 通过 `/Users/chenyanyan/Desktop/玄矶系统.command` 启动的本机开发环境使用显式、仅服务端可见的 signed-test 身份自动访问真实 Backend，不要求本机演示者先登录 Auth0。

生产身份仍是 Auth0。桌面便利模式不是第二种生产会话，也不能成为匿名或固定用户的生产回退。

## 2. 模式矩阵

| 场景 | 页面会话 | BFF 凭证来源 | 用户体验 |
| --- | --- | --- | --- |
| staging / production | Auth0 SDK 加密 HttpOnly Cookie Session | Auth0 SDK 在服务端取得的短期 Access Token | 未登录操作弹窗提示，点击“登录 / 注册”进入 Auth0 |
| 普通 development（未开启桌面模式） | 与现有 Auth0 或显式测试配置一致 | 与现有配置一致 | 401 使用同一登录提示；不静默伪造用户 |
| 桌面脚本 development | 不创建浏览器 Token 或伪造 Auth0 Cookie | `MYSTCRAG_DESKTOP_ACCESS_TOKEN`，只由 Next.js 服务端读取并转发 | `/auth/session` 返回安全的本地演示用户投影，受保护操作直接可用 |

桌面模式只有同时满足以下全部条件才可启用：

- `NODE_ENV=development`；
- `MYSTCRAG_AUTH_PROVIDER=signed-test`；
- `MYSTCRAG_ENABLE_SIGNED_TEST_AUTH=true`；
- `MYSTCRAG_DESKTOP_AUTO_AUTH=true`；
- `MYSTCRAG_APP_ORIGIN` 与 `MYSTCRAG_BACKEND_ORIGIN` 都是 loopback origin；
- `MYSTCRAG_DESKTOP_ACCESS_TOKEN` 非空。

任何 production/staging 配置、非 loopback 地址、缺少显式 opt-in 或空 Token 都必须启动时失败关闭。不得悄悄降级到匿名、Auth0 假域名或固定用户。

## 3. 普通用户登录/注册弹窗

### 3.1 触发与文案

仅当受保护业务操作实际得到 `UNAUTHORIZED` 时显示弹窗。网络故障、服务端故障、无数据和校验错误继续使用现有内联提示，不自动打开登录框。

弹窗固定文案：

- 标题：`登录后继续`
- 说明：`登录或注册后，你可以保存设计、继续抽牌并同步个人作品。`
- 主按钮：`登录 / 注册`
- 次按钮：`暂不登录`

主按钮导航到 `/auth/login?returnTo=<encoded current pathname + search + hash>`。客户端只构造相对路径；服务端继续以现有 `validateReturnTo` 作为唯一信任边界。不得把 Token、provider subject、内部 User ID 或原始错误放入 URL。

“注册”由 Auth0 Universal Login 的数据库连接和 tenant signup 设置提供。应用只承诺进入统一的“登录 / 注册”入口，不伪造本地消费者注册表单，也不声称当前 Auth0 tenant 已启用注册；运维文档必须列出 Auth0 开启 signup 的部署要求。

### 3.2 交互与可访问性

- 使用一个复用的 `AuthRequiredDialog`，保持现有暖白纸面、细边框与克制紫色主动作，不新增视觉体系。
- `role="dialog"`、`aria-modal="true"`、可关联标题与说明。
- 打开后焦点进入主按钮；Tab/Shift+Tab 不得逃出弹窗；Escape、次按钮和遮罩点击可关闭，关闭后恢复到触发操作。
- 主、次按钮至少 44px 高；手机端保留页面边缘安全间距，不出现横向滚动。
- 不自动跳转 Auth0，不在初始页面加载时打断用户；必须由受保护动作的 401 触发。
- 同一个 401 只显示一个弹窗；关闭后用户可以再次触发操作并再次看到提示。

### 3.3 接入范围

- 所有已经通过共享 `FlowNotice` 呈现 `UNAUTHORIZED` 的消费者流程自动获得弹窗，包括问卷、设计结果、DIY、作品库、个人页和水晶库。
- Tarot setup 当前把所有错误压成字符串，必须保留非认证错误的内联行为，但将 `UNAUTHORIZED` 分流到同一个弹窗。
- 独立珠子导入管理后台继续使用其 `admin/admin` development-only Cookie Session；不得把消费者 Auth0 弹窗接入管理员 401。

## 4. 桌面自动开发身份

### 4.1 服务端凭证边界

- 新变量只能命名为 `MYSTCRAG_DESKTOP_AUTO_AUTH` 与 `MYSTCRAG_DESKTOP_ACCESS_TOKEN`，禁止 `NEXT_PUBLIC_*`。
- Access Token 只存在于启动器权限为 `0600` 的 runtime env 和 Next.js/Backend 服务端进程环境中；不得进入客户端 bundle、React state、HTML/RSC payload、Cookie、localStorage、日志或错误消息。
- BFF 保持同源 `/api/**` 浏览器接口不变，并在服务端把桌面 Token 放入 Backend `Authorization: Bearer`。
- Backend 继续由现有 `SignedTestTokenAuthProvider` 校验签名、issuer、audience 和 expiry，再通过 `(issuer, subject)` 映射到内部 `User.id`。本任务不修改 Backend 或数据库。
- Auth0 模式必须继续调用真实 SDK 的 rolling、renewal、cookie 清理和错误分类代码；桌面分支不得改变这些行为。

### 4.2 页面、会话与认证路由

- 桌面模式下页面 proxy 直接放行，不能实例化 Auth0 SDK；Auth0 模式仍执行现有 rolling 并在依赖故障时失败关闭。
- 桌面模式的 `/auth/session` 返回 `200`, `Cache-Control: no-store`, `Pragma: no-cache` 和安全投影：`{"authenticated":true,"user":{"displayName":"本地演示用户"}}`。不得返回 Token、issuer、subject、audience、内部 ID 或路径。
- 桌面模式正常使用时不会触发登录弹窗。手工访问 `/auth/login` 时只能把经 `validateReturnTo` 验证的相对路径 303 回本机应用，不得跳转假 Auth0 域名或创建 Cookie。
- 桌面模式的 logout 不能声称撤销该进程级身份；如保留入口，必须明确只有停止服务或关闭桌面自动身份才会退出本地演示身份。生产 logout 行为不变。

### 4.3 启动脚本

`玄矶系统.command` 每次启动/重启服务时生成新的 signed-test Token：

- subject 固定为专用开发标识（现有 `user-phase-2c-demo` 可保留）；
- `issuedAtEpochSeconds=now`；
- `expiresAtEpochSeconds=now+28800`，不得继续使用 2100 年或其他近似永久期限；
- 导出为 `MYSTCRAG_DESKTOP_ACCESS_TOKEN`，同时导出 `MYSTCRAG_DESKTOP_AUTO_AUTH=true`；
- runtime env 权限保持 `0600`；
- 完全删除 `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN` 的生成与写入；
- Frontend LaunchAgent 不再覆盖成虚假的 `auth0`/`.invalid` 配置，直接使用 runtime env 的 signed-test development 配置。

脚本的项目路径继续指向权威本地 `main` 工作树。GLM 不得为了测试把脚本永久改指向任务分支；Codex 合并后再由脚本启动 main。

## 5. 安全与兼容边界

- 不改 Backend、Prisma、Design Contract、依赖或 CI。
- 不创建消费者密码数据库，不复用珠子管理后台账号密码，也不把 `admin/admin` 当普通用户身份。
- 不放宽现有 Auth0 returnTo、CSRF、Cookie、refresh/revocation 或日志隐私规则。
- 不在生产/staging 接受 signed-test 或桌面 Token。
- 不全局拦截所有 401；管理员 API 的认证语义保持独立。
- 不自动推送、部署或合并 main。只有 Codex 独立复审和验证通过后才可无损合并。

## 6. 验收标准

1. Auth0 未登录用户在 Tarot setup 和至少一个共享 `FlowNotice` 消费者中触发 401，看到唯一登录/注册弹窗；非认证错误仍为内联提示。
2. 弹窗 returnTo 精确保留当前相对位置，危险 returnTo 仍被服务端拒绝；键盘、Escape、关闭和手机布局符合第 3.2 节。
3. Auth0 路径的现有测试全部通过，且 production/staging 无桌面回退。
4. 合法桌面配置下 proxy 不调用 Auth0 SDK，`/auth/session` 返回安全本地投影，BFF 仅在服务端转发桌面 Token。
5. 非法桌面配置启动失败；任何前端源码、构建输出检查和文档均不出现 `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN` 的有效消费。
6. 启动器每次生成最长 8 小时 Token，runtime env 为 0600，Frontend plist 不再使用假 Auth0。
7. Frontend 全量测试、lint、typecheck、production build、相关仓库架构检查、`git diff --check` 全部通过；如 `pnpm validate` 仍遇到 main 已知的 Backend community ENOENT，必须以不在任务差异中的证据单列，不能把它记为本任务 PASS。
