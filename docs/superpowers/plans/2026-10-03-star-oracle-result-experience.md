# 星台问卦结果易读化 Implementation Plan

> **供执行代理使用：** REQUIRED SUB-SKILL：逐任务使用 `superpowers:executing-plans`；用 `- [ ]` 跟踪步骤。GPT 先串行登记唯一 owner、`task/<task-id>-<slug>` 分支、独立工作树和精确可写路径，并置为 `IN_PROGRESS`；执行者不编辑任务注册表。GPT 只审查和下发。

**Goal / 目标：** 把技术卦象页变为一眼看懂的“灵感方向 → 真实石材 → 三款可选设计 → 继续创作”。

**Architecture / 架构：** 只改变客户呈现与已持久化事实的展示投影。`oracle-coordinator.ts` 保持唯一请求生命周期和服务端幂等/修订权威；`OraclePublicSession` 的 cast/signal 仍供后台审计，客户 DOM 不渲染六爻、算法或卦名明细。进入 DIY 时消费已完成的 owner-safe 入口，不回到固定演示 ID。

**Tech Stack / 技术栈：** React、Next.js、Design Contract/Oracle Presentation DTO、现有 `BraceletPreview`、CSS Modules、tsx 测试。

**Spec / 规格：** [已批准的中文设计规格](../specs/2026-10-03-star-platform-ux-remediation-design.md) §4、§8；依赖[三语内容计划](2026-10-03-star-three-locale-content.md)的投影契约/服务端、[DIY 入口计划](2026-10-03-star-diy-entry-ownership.md)的所有权恢复与[手串工作台计划](2026-10-03-star-bracelet-workbench.md)的紧凑预览。

## 全局约束

- 客户页面（含展开内容）不得出现“第几爻、动爻、阴阳、上下卦、三钱算法版本”、`THREE_COIN`、`BALANCED` 或英文内部占位。
- 解释仅用于文化观察、配色/排列设计灵感；不得作确定性命运、医疗或水晶功效承诺。
- 三款推荐仅使用已持久化推荐、真实目录 SKU/库存/价格；未得到投影或材料时显示明确可重试状态，不编造结果。
- 切换语言、重进结果与重试读取不得调用新起卦；推荐失败仅重试 recommendations，保存失败保留选择。

## 评审重点

1. 没有动爻或有六个动爻：都仍得到简明设计线索，不暴露专业结构（任务 1）。
2. 推荐只有 CAST 状态：主题可读，三卡不假装存在，只有“重试匹配”（任务 2）。
3. 某推荐 SKU 下架：不显示其为可立即选购，不改变原会话中的报价（任务 2）。
4. 英文或繁体长文：卡片不越界，价格/选择按钮可见（任务 2）。
5. 保存发生网络歧义：恢复同一会话/设计选择而非新建卦（任务 2）。

---

### 任务 1：结果视图结构（拟登记 `TASK-UX-ORACLE-FE-001`；Qwen 3.8 Flash / `FRONTEND`）

**文件：** 修改 `apps/frontend/src/features/oracle/components/oracle-result.tsx`、`apps/frontend/src/features/oracle/oracle.module.css`、`apps/frontend/src/features/oracle/oracle-result.test.tsx`、`docs/UI_DESIGN_SYSTEM.md` 中 Oracle 客户呈现段。`oracle-lines.tsx` 和 `oracle-reveal.tsx` 暂不删除，只断开客户结果页挂载；清理需另立生命周期任务。

**接口：** `OracleResultBodyProps` 添加 `presentation: OraclePresentationResponse | null`；移除 `detailsOpen/onToggleDetails` 的客户使用。新 `OracleDesignCompass` 只消费 `presentation.cues`，分别展示“主色/节奏/点睛”的图形和文字；`OracleDesignCard` 消费对应 `presentation.cards`，卡片标题/说明从三语投影来，设计对象仍决定预览与价格。

- [ ] 写失败测试：渲染 DOM 不包含技术术语、算法或英文枚举；主题与三个线索同屏可读；图形有文本等价物；无投影时有加载/重试而不是空白。
- [ ] 运行 `pnpm --filter @mystcrag/frontend exec tsx --test src/features/oracle/oracle-result.test.tsx`，确认新增断言失败。
- [ ] 实现用户信息层级，删除技术 details 的客户挂载；更新 UI 设计系统的重叠段落，不改 cast DTO 和 coordinator。
- [ ] 重跑该测试、前端 typecheck 与 lint，均通过；提交 `feat(frontend): explain Oracle as design cues`。

### 任务 2：真实石材与三款方案状态（拟登记 `TASK-UX-ORACLE-FE-002`；Qwen 3.8 Flash / `FRONTEND`，与任务 1 串行）

**文件：** 修改 `apps/frontend/app/oracle/result/[sessionId]/oracle-result-client.tsx`、`apps/frontend/src/features/oracle/components/oracle-result.tsx`、`apps/frontend/src/features/oracle/oracle-result.test.tsx`、`apps/frontend/src/features/oracle/oracle-coordinator.test.tsx`、`apps/frontend/src/features/oracle/oracle.module.css`。紧凑手串预览的尺寸、线和几何不在本任务编辑。

**接口：** 结果页按当前 `DisplayLocale` 调用只读 `oracleApi.presentation(sessionId, locale)`；`OracleMaterials` 按 `beadProductId` 关联已选推荐中的真实材料/目录，显示名称、角色、规格和可用性；卡片使用 `designId` 稳定选中态。结果页不基于卦名臆造石材，也不改 `OracleCoordinator` 的 save/retry 策略。

- [ ] 写失败测试：三语请求只发 GET；有三个不同方向且真实 `designId`；石材图/名/角色来自匹配的 SKU；下架 SKU 处理；推荐失败保留主题；保存失败保留选择；“继续创作”只进入当前用户拥有的设计。
- [ ] 运行 Oracle 结果和 coordinator 目标测试，确认红因。
- [ ] 实现数据关联、加载/错误/空状态、三卡标题/正文两三行限制与可访问“查看材料”；主按钮仅在有已选推荐时可用。
- [ ] 重跑 Oracle 测试、前端 typecheck/lint；浏览器检查 320×568、390×844、1440×900、1440×560 和 200% 文本缩放，无溢出。
- [ ] 提交 `feat(frontend): pair Oracle cues with real crystal designs`。

### 任务 3：问卦流程回归（拟登记 `TASK-UX-ORACLE-QA-001`；DeepSeek V4.1 Flash / `QA`；GPT 独立复核）

**文件：** 修改 `tests/oracle-journey.test.mjs`（若当前不存在，则新建同名跨工作区测试）、`docs/INTERACTION_TEST_PLAN.md` 的 Oracle 验收段；浏览器证据存放在 `docs/governance/QA_EVIDENCE_RETENTION.md` 规定位置，不写入源码树。

- [ ] 写失败跨模块断言：一次激活只一次 create；刷新、三语切换与返回结果不抽新卦；推荐失败只重试推荐；保存重放不改 revision/选择；页面无技术字段。
- [ ] 运行 `node --test tests/oracle-journey.test.mjs`，确认新增断言红因，再在任务 1/2 完成后运行至绿。
- [ ] 运行全部 Oracle 前后端相邻测试、架构测试与 `pnpm validate`；录制普通首次用户能说出主题、石材和下一步的可用性结果。
- [ ] 提交 `test(oracle): cover plain-language result journey`。

**交接门槛：** 产品所有者先确认问卦结果效果图；自动化和人工首次用户检查均通过，且无技术字段回流到客户视图。
