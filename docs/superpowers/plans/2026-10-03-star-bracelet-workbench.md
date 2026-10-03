# 手串真实感与 DIY 工作台 Implementation Plan

> **供执行代理使用：** REQUIRED SUB-SKILL：逐任务使用 `superpowers:executing-plans`；用 `- [ ]` 跟踪步骤。GPT 先串行登记唯一 owner、`task/<task-id>-<slug>` 分支、独立工作树和精确可写路径，并置为 `IN_PROGRESS`；执行者不编辑任务注册表。GPT 只审查和下发。

**Goal / 目标：** 在结果卡和 DIY 中呈现尺寸可信、有细微间隔和透明弹力线的手串；保留旧版桌面/手机布局，托盘更大且没有背景板，散珠更真，操作台不再溢出或低对比。

**Architecture / 架构：** `@mystcrag/bracelet-engine.createBraceletLayout` 保持唯一槽位/角度权威；前端只做毫米到舞台像素的展示投影。`FlatBraceletEditor` 继续独占生产编辑，`BraceletPreview` 只读；散珠控制器与托盘命中共享舞台尺寸。[DIY 入口计划](2026-10-03-star-diy-entry-ownership.md)先交付空托盘首珠创建，本计划不预放珠子。

**Tech Stack / 技术栈：** Bracelet Engine、React/Next.js、现有散珠物理控制器、CSS、Canvas PNG 导出、tsx 测试与浏览器测量。

**Spec / 规格：** [已批准的中文设计规格](../specs/2026-10-03-star-platform-ux-remediation-design.md) §4.2、§5.1–5.3、§8；[当前几何契约](../../BRACELET_GEOMETRY.md)。

## 全局约束

- 暂不改变 47% 托盘外圈命中比例或 37% 内圈散珠半径；在桌面扩大舞台实现可见托盘约 1.4 倍。若实测必须改变命中契约，先停下登记独立 `BRACELET` 任务，同步 `docs/BRACELET_GEOMETRY.md`、引擎和测试，再继续前端。
- `createBraceletLayout(..., {gapMm})` 已支持可见缝隙；展示 `gapMm` 不进入 DesignV1 的材料长度、定价和订单。6/8/10/12 mm 视觉比例须保留。
- 保留真实获批珠材图与无滤镜原则；不得把线画成粗白环，也不能借 `scale()` 掩盖碰撞或命中错误。
- 静态选中橘圈删除，但键盘焦点样式和 `aria-pressed` 保留；44 px 命中下限不意味着把珠子图片画到 44 px。
- 桌面保留左材料库/中托盘/右检查区；手机保留上托盘/下材料面板。中央只有实物托盘与中性页面底色，不显示方框或额外背景板。

## 评审重点

1. 24 颗混合珠径预览：相邻图像不重叠、线段可见且顺序稳定（任务 1）。
2. 1 颗与 40 颗的边界：不出现 NaN、粗线或超出方形舞台（任务 1）。
3. 托盘增大且背景板移除后，拖出圆圈删除/圈内取消/近环换位仍一致（任务 2）。
4. 小尺寸散珠的图片、阴影和可点击区域分离，选择可见但无常驻橘圈（任务 2）。
5. 导出 PNG 与屏幕上的材质/顺序/尺寸/线一致；不更改价格与腕围（任务 3）。

---

### 任务 1：共享手串展示投影与紧凑预览（拟登记 `TASK-UX-BRACELET-FE-001`；Qwen 3.8 Flash / `FRONTEND`）

**文件：** 新增 `apps/frontend/src/features/design/model/bracelet-display-layout.ts` 及测试；修改 `apps/frontend/src/features/design/components/bracelet-preview.tsx`、`flat-bracelet-editor.tsx` 与相邻测试。若发现纯 Engine 缺陷，按全局约束先开 `BRACELET` 任务，不在本任务改 `packages/bracelet-engine/**`。

**接口：** `createBraceletDisplayLayout(design: PublicDesignV1, options: { framePx: number; visualGapMm: number }): readonly DisplaySlot[]`；`DisplaySlot` 至少有 `componentId,xPx,yPx,diameterPx,angleRad`。内部把有序珠子/INLINE 配件的实际长度交给 `createBraceletLayout`，用统一系数缩放到安全舞台，卡片/编辑器消费同一结果。`visualGapMm` 仅作用于显示投影，不写回 design。

- [ ] 写失败测试：24 颗 6/8/10 mm 混合珠最小可见间距 ≥2 px（320 px 卡片）；相同设计 320/560 px 的顺序一致；单珠/40 珠有限值；组件 ID 稳定；显示 gap 不改变设计对象与 fit。
- [ ] 运行 `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/bracelet-display-layout.test.ts`，确认红因。
- [ ] 实现展示投影，并让 `BraceletPreview`/`FlatBraceletEditor` 消费；线在珠图下层，以相邻中心路径绘制细、半透明线段，只有露出缝隙的部分可见。
- [ ] 重跑目标测试、前端 typecheck/lint 与现有 fit/slot 测试，均通过；提交 `feat(frontend): share size-aware bracelet display layout`。

### 任务 2：托盘与散珠的物理一致性（拟登记 `TASK-UX-BRACELET-FE-002`；Qwen 3.8 Flash / `FRONTEND`，与任务 1 串行）

**文件：** 修改 `apps/frontend/src/features/design/components/loose-bead-stage.tsx`、`display-tray.tsx`、`apps/frontend/src/features/design/model/loose-bead-controller.ts`、`display-tray.ts`、`apps/frontend/app/styles/star-workbench.css`、相关现有测试。若托盘素材本身必须重制，单独登记 `ASSET` 任务，仅改 `apps/frontend/public/trays/**`。

**接口：** 保留 `mmToRadiusPx(diameterMm, innerRadiusPx)` 和 `isPointOutsideTray(point, rect, radiusRatio=0.47)`，只调整视觉比例/舞台布局，必须让粒子半径、碰撞、拖动飞入与命中使用同一个新半径。标准桌面 1440×900 的实测托盘外径为现状基准的约 `1.4×`（允许 1.30–1.45 作为响应式安全区）；1440×560、手机不得裁切。托盘后方是纯净中性页面底色，不加载石纹、星图或纸纹背景。

- [ ] 写失败测试：6/8/10/12 mm 图片直径严格递增且碰撞半径同步；拖出/圈内/近环三态不变；选中没有常驻橘圈但 `aria-pressed` 和 focus-visible 仍在；托盘舞台无静态方框/图片背景；空工作态没有预放珠。
- [ ] 运行散珠/托盘相邻测试，确认新增断言红因。
- [ ] 扩大舞台而非只变换图片；移除舞台常态描边，添加克制接触阴影，只有拖动时显示可删除边界。
- [ ] 重跑相邻测试、前端 typecheck/lint；在 1440×900 读取旧/新 DOM bounding box 比率并记录证据，复查短视口和手机。
- [ ] 提交 `feat(frontend): enlarge coherent DIY tray and loose beads`。

### 任务 3：工作台密度、按钮与导出一致性（拟登记 `TASK-UX-BRACELET-FE-003`；Qwen 3.8 Flash / `FRONTEND`，与任务 2 串行）

**文件：** 修改 `apps/frontend/src/features/design/components/diy-editor.tsx`、`apps/frontend/app/styles/star-workbench.css`、`apps/frontend/src/features/design/components/flat-bracelet-editor.tsx`、`apps/frontend/src/features/design/components/diy-editor.test.tsx`（不存在则新增）、现有可访问性/工作台合同测试；配色 token 只消费[页面视觉计划](2026-10-03-star-page-family-visual-qa.md)先落地的共享变量。

**接口：** 以旧版桌面左侧材料库、中央托盘、右侧当前选择/适配，以及旧版手机上托盘、下材料面板为布局基线，只融合当前版本的可访问状态与权威信息。顶部次要“保存草稿”，右侧粘性底部唯一主要“完成设计”；空托盘阶段提示先选珠，不能伪造保存或报价。商品名称一行，规格/价单独一行；横向区露出下一项+箭头，触控和键盘均可继续。PNG 导出读取与 `FlatBraceletEditor` 相同的 `createBraceletDisplayLayout`，不重做一套均分角度。

- [ ] 写失败测试：旧版桌面三区/手机上下区顺序不变；主完成按钮恰好一个；空托盘不能保存/完成；当前状态/失败/保存回执可见；目录名称不折双行且箭头可访问；连接线与预览/导出序列一致；价格/库存/修订源值不变。
- [ ] 运行工作台与导出相邻测试，确认红因。
- [ ] 改操作区与导出投影，保留 optimistic revision 恢复；不改订单 API 或库存规则。
- [ ] 重跑目标测试、前端 typecheck/lint、`pnpm validate`；在 320×568、390×844、768×1024、1440×900、1440×560 和 200% 下检查完成按钮可达、零横向溢出。
- [ ] 提交 `feat(frontend): refine DIY workbench and export parity`。

**交接门槛：** 产品所有者先批准 DIY 桌面和手机效果图；QA 通过缩图/成串/散珠/导出一致性及价格、库存、修订、双用户回归。不得在图片看起来更大时牺牲操作边界。
