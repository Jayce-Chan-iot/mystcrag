# 玄矶 Mystcrag 本地演示指南

## 1. 前置条件

- Node.js 22 或更高版本
- pnpm 11
- Docker Desktop / Docker Engine

以下命令均在仓库根目录执行。

## 2. 安装并准备数据库

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

`postinstall` 会自动生成 Prisma Client；不需要手工补救。重复运行 seed 应保持稳定。

## 3. 生成短期开发身份

本地 MVP 没有伪造固定用户。Backend 只接受签名 Bearer token，下面的 token 对 seed 用户 `user-phase-2c-demo` 有效 8 小时。

```bash
export NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN="$(
  pnpm --filter @mystcrag/backend exec tsx -e \
    'import { signTestAccessToken } from "./src/auth/signed-test-auth-provider.ts"; const now=Math.floor(Date.now()/1000); console.log(signTestAccessToken({subject:"user-phase-2c-demo",issuer:String(process.env.MYSTCRAG_AUTH_ISSUER),audience:String(process.env.MYSTCRAG_AUTH_AUDIENCE),issuedAtEpochSeconds:now,expiresAtEpochSeconds:now+28800},String(process.env.MYSTCRAG_AUTH_SIGNING_SECRET)))'
)"
```

确认变量非空：

```bash
test -n "$NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN" && echo "demo token ready"
```

不要提交生成后的 token。`signed-test` Provider 只允许 `NODE_ENV=development|test` 且必须显式启用；生产环境会 fail closed。

## 4. 启动服务

保持当前终端环境，在两个新终端中分别执行。每个终端都先加载 `.env`；Frontend 终端还需重新执行第 3 步生成 token，因为 shell 变量不会跨终端自动继承。

终端 A — Backend：

```bash
set -a; source .env; set +a
pnpm --filter @mystcrag/backend dev
```

终端 B — Frontend：

```bash
set -a; source .env; set +a
# 在这个终端重新执行第 3 步的 export 命令
pnpm --filter @mystcrag/frontend dev
```

打开 [http://localhost:3000](http://localhost:3000)。Backend 健康检查为 [http://localhost:4000/health](http://localhost:4000/health)。

提示：`NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN` 必须在启动 Next.js 之前存在；改动后需重启 Frontend。请勿启用 Mock，真实演示不需要 `NEXT_PUBLIC_MYSTCRAG_MOCK_API`。

## 5. 停止与清理

Frontend/Backend 终端按 `Ctrl+C`。数据库可保留供下次演示；如需停止容器：

```bash
pnpm db:down
```

## 常见问题

- Backend 启动时报认证未配置：确认已 `source .env`，并且 `NODE_ENV=development`。
- 页面提示未认证：确认 Frontend 启动前已生成非空 token，随后重启 Frontend。
- 旧 token 失效：重新执行第 3 步并重启 Frontend。
- 端口冲突：释放 3000/4000/5432，或同步修改 Backend、Frontend 与数据库连接配置。
- 需要重新初始化数据：先确认可以删除本地演示数据，再执行 `pnpm db:reset`；该命令是破坏性的，不属于正常启动步骤。
