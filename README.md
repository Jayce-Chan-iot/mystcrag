# 玄矶 Mystcrag

AI 驱动的个性化水晶手串设计平台。当前仓库已达到本地 MVP 演示就绪状态：用户可完成问卷、获得三套真实持久化方案、进入 Three.js DIY 编辑器、更换珠材、保存并创建不可变订单快照。

## Workspace

- `apps/frontend`: Next.js Web 应用
- `apps/backend`: Fastify API 服务
- `apps/knowledge-worker`: 知识采集、评审与维护任务 Worker
- `apps/mcp-server`: 面向 MCP 客户端的知识检索与设计工具服务
- `packages/ui`: 共享 UI 基础组件
- `packages/database`: Prisma 数据模型与 PostgreSQL 持久化
- `packages/ai-agent`: 可解释的规则型推荐 Agent
- `packages/three-engine`: Three.js / React Three Fiber 引擎
- `packages/bracelet-engine`: 与 UI/DOM/Three.js 解耦的手串几何、命中与适配内核
- `packages/context-resolver`: 问卷与 Tarot 推荐上下文归一化
- `packages/design-contract`: 设计、目录、订单、知识与推荐共享契约
- `packages/design-engine`: 确定性布局、规则求值与评分引擎
- `packages/knowledge-core`: 知识检索、编译、评审、控制台与评测核心
- `packages/knowledge-ingestion`: 来源抓取、抽取、安全和采集流水线
- `packages/tarot-engine`: Tarot 洗牌、选牌、揭示与设计信号内核
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

开发身份生成、Backend/Frontend 启动和验收步骤见 [`docs/LOCAL_DEMO_GUIDE.md`](docs/LOCAL_DEMO_GUIDE.md)。所有规范与历史报告的按模块入口见 [`docs/INDEX.md`](docs/INDEX.md)。

## Release status

- 独立 QA：33/33 项通过，`mvpReadiness: READY`
- 完整工作区校验：通过
- PostgreSQL 17 实库测试：17/17 通过
- 当前仅有一个非阻断 Three.js 环境模糊采样警告

详见 [`docs/FINAL_MVP_DELIVERY_REPORT.md`](docs/FINAL_MVP_DELIVERY_REPORT.md) 与 [`docs/QA_PHASE_3_REPORT.md`](docs/QA_PHASE_3_REPORT.md)。
