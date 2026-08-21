# 玄矶 Mystcrag 本地真实后端演示指南

## 1. 前置条件与访问地址

- Node.js 22 或更高版本
- pnpm 11（仓库声明版本为 `pnpm@11.4.0`）
- Docker Desktop / Docker Engine
- 未被占用的 3000、4000 和 5432 端口

以下命令均在仓库根目录执行。Frontend 为 [http://localhost:3000](http://localhost:3000)，Backend 健康检查为 [http://localhost:4000/health](http://localhost:4000/health)。Next.js 会把同源 `/api/*` 请求代理到 `MYSTCRAG_BACKEND_ORIGIN`，验收不需要 Mock API。

## 2. 安装、迁移与演示数据

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:up
set -a
source .env
set +a
pnpm db:migrate
pnpm db:seed
```

`pnpm db:migrate` 运行 Prisma `migrate deploy`，会包含增量迁移 `20260820100000_add_tarot_sessions`。`postinstall` 会生成 Prisma Client；重复运行 seed 应保持稳定。Seed 用户是 `user-phase-2c-demo`，目前商品库基线是 18 个水晶知识条目、36 个可售材料 SKU（每个水晶各一个 CNY 和 TWD SKU）。塔罗推荐只使用当前币种的活跃材料和服务端权威价格。

### 仅重置本地开发库

```bash
set -a; source .env; set +a
pnpm db:reset
pnpm db:seed
```

`pnpm db:reset` 会对当前 `DATABASE_URL` 执行 `prisma migrate reset --force`，会删除该数据库的所有数据。执行前必须核对 URL 只指向可丢弃的本地演示库；不得对共享、预发或生产库执行。`pnpm db:test` 另外要求专用、空的 `mystcrag_*test*` 数据库，不会替你清空已有表。

## 3. 开启塔罗入口与问题隐私

`.env.example` 中塔罗默认关闭。本地演示改为：

```dotenv
MYSTCRAG_TAROT_ENABLED="true"
MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY=""
```

Backend 和服务端渲染的 Frontend 只认精确小写值 `"true"`；缺失、`false`、`TRUE`、`1` 或带空格的值都是关闭。关闭时首页和导航只隐藏塔罗入口，AI 设计与 DIY 仍可用；新建塔罗会话返回 `501 NOT_IMPLEMENTED`，已有会话仍可恢复。修改开关后需重启 Backend 和 Frontend。

`MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY=""` 表示不安装问题加密端口。用户不勾选保存问题时，原文只在当次请求内存中使用，不进日志、浏览器存储或数据库。若勾选保存但密钥为空，Backend 在商品查询、方案生成和持久化前返回 `VALIDATION_ERROR`，页面以行内提示呈现，不会降级为明文或可逆编码。

如果演示确实要测试“明确同意保存问题”，在不输出密钥的情况下生成临时 32 字节 base64 密钥：

```bash
export MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"
```

该变量必须在 Backend 启动前存在；不要写回 `.env.example`、不要提交，也不要用于真实生产数据。非空但格式错误的密钥会让 Backend 启动失败，以防止错误配置静默降级。

## 4. 生成 8 小时本地开发凭证

内置 `signed-test` Provider 只能在 `NODE_ENV=development|test` 且显式启用时使用。它不是固定用户或跳过登录；Backend 仍会验证签名、issuer、audience 和过期时间。

```bash
set -a; source .env; set +a
export MYSTCRAG_AUTH_SIGNING_SECRET="${MYSTCRAG_AUTH_SIGNING_SECRET:-$(openssl rand -hex 32)}"
export NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN="$(
  pnpm --filter @mystcrag/backend exec tsx -e \
    'import { signTestAccessToken } from "./src/auth/signed-test-auth-provider.ts"; const now=Math.floor(Date.now()/1000); console.log(signTestAccessToken({subject:"user-phase-2c-demo",issuer:String(process.env.MYSTCRAG_AUTH_ISSUER),audience:String(process.env.MYSTCRAG_AUTH_AUDIENCE),issuedAtEpochSeconds:now,expiresAtEpochSeconds:now+28800},String(process.env.MYSTCRAG_AUTH_SIGNING_SECRET)))'
)"
test -n "$NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN" && echo "demo token ready"
```

不要提交 token。Frontend 只在启动时读取 `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN`；重新生成后必须重启 Frontend。

`.env.example` 不包含可用签名密钥。上面的命令会为当前 shell 生成临时值，签发 token 和启动 Backend 必须使用同一值。如果分两个终端启动，将同一临时值配置到本地 `.env` 后再分别 `source .env`；该文件不得提交。

## 5. 一键与分组启动（真实 Backend）

最简单的一键开发启动：在已 `source .env` 且生成 token 的同一终端执行：

```bash
pnpm dev
```

`pnpm dev` 通过 Turborepo 并行启动 Frontend 和 Backend。需要分开查看日志时，在两个都已加载 `.env` 的终端运行：

```bash
# 终端 A
pnpm --filter @mystcrag/backend dev

# 终端 B（还必须有 NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN）
pnpm --filter @mystcrag/frontend dev
```

验收环境不得设置 `NEXT_PUBLIC_MYSTCRAG_MOCK_API=true`。可用以下命令确认未开启 Mock：

```bash
test "${NEXT_PUBLIC_MYSTCRAG_MOCK_API:-}" != "true" && echo "real Backend mode"
curl --fail http://localhost:4000/health
```

## 6. 演示流程

1. 打开首页，确认 AI 灵感设计、塔罗水晶引导、DIY 创作三个并列入口。
2. 进入塔罗，选主题、单张或过去/现在/未来三张牌阵；问题可留空，默认不保存。
3. 点选牌背，确认服务端按槽位接受并在全部选完后翻牌。
4. 查看反思文案、色彩/材料建议和平铺的三个真实价格方案。
5. 选一个方案，保存并进入 `/diy/:designId`，验证载入的是同一个持久化 `TAROT_GUIDED` 设计。
6. 回到首页再走一次 AI 设计和直接 DIY，确认开启塔罗没有改变原有入口。

## 7. 生产构建验证与启动边界

### 仅验证生产构建

第 2 节的 `.env` 为本地演示明确设置了 `NODE_ENV=development`。即使当前 shell 已经 `source .env`，构建时也必须在命令前显式覆盖：

```bash
NODE_ENV=production pnpm build
```

这条命令只证明生产优化产物能构建，不等于生产系统可启动或可部署。命令前缀的 `NODE_ENV=production` 会覆盖当前 shell 从 `.env` 加载的开发值。

### 本地开发身份演示

需要可操作的本地演示时，只使用第 4–5 节的 `signed-test` 开发身份与 `pnpm dev`。不要把这些凭据或该 Provider 用于生产启动。

### 生产启动前置条件

当前仓库没有生产 OIDC/认证 Provider，只有会在 `NODE_ENV=production` 下 fail closed 的 `signed-test`。因此，**当前没有可执行的生产模式全栈启动命令**；在接入受支持的生产认证 Provider 前，Backend 应拒绝启动，而不是回退到开发登录。真实生产还必须配置托管 PostgreSQL 与密钥、执行迁移、完成塔罗素材权利审查，再显式开启 flag。

## 8. 已知限制与排查

- 没有生产认证 Provider；不要在生产使用 `signed-test`。
- 没有实时塔罗 AI Provider；当前使用经验证的确定性反思文案，不影响真实商品、价格和设计生成。
- 尚无用户手围/预算偏好存储适配器；塔罗推荐默认目标手围 155 mm，不伪造预算。
- 塔罗抽牌页尚需在可控 Chrome 上补做 1440×1024 和 390×844 的同状态像素对比；源码、交互测试和构建不替代该视觉验收。
- 公开/商业发布的代码、牌面、牌背、字体与其他图像权利证据尚未闭环；见 `OSS_RESEARCH.md`。
- Backend 启动报认证未配置：确认已 `source .env`，且本地演示为 `NODE_ENV=development`。
- 页面报未认证：重新生成非空 token，然后重启 Frontend。
- 首页没有塔罗入口：确认两个进程启动前都读到精确的 `MYSTCRAG_TAROT_ENABLED=true`。
- 勾选保存问题后收到行内校验：这是空密钥的预期 fail-closed 行为；取消勾选或为本地测试配置临时有效密钥。

停止 Frontend/Backend 用 `Ctrl+C`，停止数据库容器用 `pnpm db:down`。
