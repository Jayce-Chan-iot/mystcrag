# 玄矶 Mystcrag

AI 驱动的个性化水晶手串设计平台。当前仓库已达到本地 MVP 演示就绪状态：用户可完成问卷、获得三套真实持久化方案、进入 Three.js DIY 编辑器、更换珠材、保存并创建不可变订单快照。

## Workspace

- `apps/frontend`: Next.js Web 应用
- `apps/backend`: Fastify API 服务
- `packages/ui`: 共享 UI 基础组件
- `packages/database`: Prisma 数据模型与 PostgreSQL 持久化
- `packages/ai-agent`: 可解释的规则型推荐 Agent
- `packages/three-engine`: Three.js / React Three Fiber 引擎
- `docs`: 产品、架构、验收与交付文档
- `tests`: 跨工作区架构与生命周期测试

## Local demo

环境要求：Node.js 22+、pnpm 11、Docker。

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

开发身份生成、Backend/Frontend 启动和验收步骤见 [`docs/LOCAL_DEMO_GUIDE.md`](docs/LOCAL_DEMO_GUIDE.md)。完整工程约定见 [`docs/ENGINEERING_GUIDE.md`](docs/ENGINEERING_GUIDE.md)。

## Release status

- 独立 QA：33/33 项通过，`mvpReadiness: READY`
- 完整工作区校验：通过
- PostgreSQL 17 实库测试：17/17 通过
- 当前仅有一个非阻断 Three.js 环境模糊采样警告

详见 [`docs/FINAL_MVP_DELIVERY_REPORT.md`](docs/FINAL_MVP_DELIVERY_REPORT.md) 与 [`docs/QA_PHASE_3_REPORT.md`](docs/QA_PHASE_3_REPORT.md)。
