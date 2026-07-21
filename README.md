# 玄矶 Mystcrag

AI 驱动的个性化水晶手串设计平台。本仓库当前处于工程初始化阶段，只提供可扩展的应用、领域包与接口骨架。

## Workspace

- `apps/frontend`: Next.js Web 应用
- `apps/backend`: Node.js API 服务
- `packages/ui`: 共享 UI 基础组件
- `packages/database`: Prisma 数据模型
- `packages/ai-agent`: AI Agent 接口层
- `packages/three-engine`: 3D 引擎领域接口层
- `docs`: 产品、架构与协作文档
- `tests`: 跨工作区架构测试

## Local development

1. 安装 Node.js 22 与 pnpm 11。
2. 复制 `.env.example` 为 `.env` 并填写本地配置。
3. 执行 `pnpm install`。
4. 执行 `pnpm dev`。

完整约定见 `docs/ENGINEERING_GUIDE.md`。
