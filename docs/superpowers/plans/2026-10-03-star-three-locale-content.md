# 简体、繁体、英文全站内容 Implementation Plan

> **供执行代理使用：** REQUIRED SUB-SKILL：逐任务使用 `superpowers:executing-plans`；用 `- [ ]` 跟踪步骤。GPT 先串行登记唯一 owner、`task/<task-id>-<slug>` 分支、独立工作树和精确可写路径，并置为 `IN_PROGRESS`；执行者不编辑任务注册表。GPT 只审查和下发。

**Goal / 目标：** 页眉真正提供 `zh-CN`、`zh-TW`、`en-US` 切换，覆盖全部主要页面与动态设计文案，不重起卦、不改变空托盘/已有设计、价格或当前编辑。

**Architecture / 架构：** 显示语言与设计/会话创建时的 `locale` 分离。Next.js 页眉读取经验证的非敏感语言 Cookie 作为 SSR 初值；客户端 `LocaleProvider` 切换纯展示状态。动态 Oracle/设计文案由服务端按原会话/设计的稳定事实和版本化、人工审校模板投影，不修改持久化快照；空托盘临时状态不因切换丢失或被自动创建。

**Tech Stack / 技术栈：** Next.js、React Context、TypeScript、Zod、Fastify、现有 AI Agent 原创文案模板、Intl。

**Spec / 规格：** [已批准的中文设计规格](../specs/2026-10-03-star-platform-ux-remediation-design.md) §4、§5.1、§7、§8。

## 全局约束

- 仅 `zh-CN`、`zh-TW`、`en-US` 三种展示语言；默认 `zh-CN`；选项原文为“简体中文 / 繁體中文 / English”。切换语言不是币种切换，货币小单位规则不变。
- 已创建 Oracle 会话的 `cast`、`sessionId`、`revision`、推荐设计 ID、SKU、价格、库存和用户选择均不变；空托盘也不因切换而预放珠子或产生设计 ID；请求仅返回展示投影。
- 不以自动机翻或内置英文占位充数；所有文化/设计文案与错误状态须人工审校，不作命运、疗效或保证性承诺。
- Authing Cookie 仍是唯一身份会话；语言 Cookie 不存认证信息，也不能作为 actor ID。
- 所有运行时任务遵循契约先行与单 owner 锁；不要让两个任务同时编辑 `app/layout.tsx` 或 `oracle-result.tsx`。

## 评审重点

1. 在问卦结果或空托盘切换语言：不发送 create/recommend/save POST，不增加珠子、设计 ID 或更改选中方案（任务 1、3、4）。
2. 无语言 Cookie、伪造值或浏览器禁用存储：SSR 与水合均为简中且无闪烁/异常（任务 1）。
3. 旧会话仅有单语故事：仍提供三语安全投影，不混排、不修改数据库（任务 3）。
4. 数字格式：CNY/TWD 的金额不被简化为同一除以 100 规则（任务 4）。
5. 320 px、200% 缩放与英文长词：菜单、按钮和状态不溢出（任务 4）。

---

### 任务 1：语言基础与菜单（拟登记 `TASK-UX-I18N-FE-001`；Qwen 3.8 Flash / `FRONTEND`）

**文件：** 新增 `apps/frontend/src/i18n/locale.ts`、`locale-provider.tsx`、`messages/zh-CN.ts`、`messages/zh-TW.ts`、`messages/en-US.ts`、`locale.test.tsx`、`apps/frontend/src/components/language-switcher.tsx` 及测试；修改 `apps/frontend/app/layout.tsx`、`apps/frontend/app/navigation.ts`、`apps/frontend/components/mobile-bottom-nav.tsx`、`apps/frontend/app/styles/star-shell.css`、`docs/governance/FEATURE_REGISTRY.md` 和 `docs/governance/CANONICAL_COMPONENTS.md` 的语言状态权威段。

**接口：** 前端展示类型 `type DisplayLocale = "zh-CN" | "zh-TW" | "en-US"`；`parseDisplayLocale(value: unknown): DisplayLocale`；`useDisplayLocale(): { locale: DisplayLocale; setLocale(locale: DisplayLocale): void; t(key: MessageKey): string }`。动态 DTO 校验仍以任务 2 的 Contract 为准。菜单位于桌面页眉右侧、移动页眉可发现位置或主菜单顶部；设置 `html[lang]` 和受限 `mystcrag_locale` Cookie，切换后实际内容随语言改变，不导航、不重载、不清理当前表单/空托盘/编辑 state。

- [ ] 写失败测试：非法 Cookie → 简中；三个原文菜单选项；页眉可发现且键盘可操作；切换后导航/至少一段页面正文实际变化，当前 route/输入/空托盘/设计选择不变；字典键三语同构。
- [ ] 运行 `pnpm --filter @mystcrag/frontend exec tsx --test src/i18n/locale.test.tsx src/components/language-switcher.test.tsx`，确认因未实现失败。
- [ ] 实现 provider、菜单与共享静态字典；不增加第二套全局设计状态。
- [ ] 重跑目标测试、前端 typecheck/lint；检查 SSR `lang`、刷新/深链的 Cookie 初值。
- [ ] 提交 `feat(frontend): add three-language display preference`。

### 任务 2：动态展示投影契约（拟登记 `TASK-UX-I18N-CONTRACT-001`；DeepSeek V4.1 Flash / `CONTRACT`；与 DIY 契约任务串行）

**文件：** 新增 `packages/design-contract/src/schemas/localized-presentation.schema.ts` 及测试；修改该包 `src/index.ts`、`docs/API_SPECIFICATION.md`、`docs/DESIGN_CONTRACT_V1.md`。

**接口：** `LocalizedPresentationRequestSchema` 严格接受 `locale: "zh-CN" | "zh-TW" | "en-US"`；`OraclePresentationResponseSchema` 返回 `{ sessionId, sourceRevision, locale, headline, summary, cues:[{kind:"COLOR"|"RHYTHM"|"ACCENT",text}], materials:[{beadProductId,role,label}], cards:[{designId,title,description}] }`；`DesignPresentationResponseSchema` 返回 `{ designId, sourceRevision, locale, title, story, materialLabels:[{beadProductId,label}] }`；`TarotPresentationResponseSchema` 返回 `{ sessionId, sourceRevision, locale, headline, summary, cardReflections:[{slot,text}], colorStory, designRationale, disclaimer }`。均不得返回另一份抽牌/卦象或价格权威。

- [ ] 写失败测试：三语标识合法、第四语言与未知字段拒绝、材料/卡片仅标识关联、无价格/权威设计复制。
- [ ] 运行 `pnpm --filter @mystcrag/design-contract exec tsx --test tests/localized-presentation.test.ts`，确认红因。
- [ ] 实现 schema/export 和三条只读 API 文档：`GET /api/oracle/sessions/:sessionId/presentation?locale=...`、`GET /api/design/:id/presentation?locale=...`、`GET /api/tarot/sessions/:sessionId/presentation?locale=...`。
- [ ] 重跑目标测试和 Contract typecheck，通过后提交 `feat(contract): define localized presentation projections`。

### 任务 3：服务端原创三语投影（`AI`、`BACKEND`、`TAROT` 各登记一个 DeepSeek V4.1 Flash 任务，拟 ID `TASK-UX-I18N-AI-001` → `TASK-UX-I18N-BE-001` → `TASK-UX-I18N-TAROT-001`；每项独立分支/可写路径）

**AI 子任务文件：** 修改 `packages/ai-agent/src/oracle/oracle-copy.service.ts`，新增 `packages/ai-agent/src/oracle/oracle-presentation.ts`、三语审校模板及测试，更新 `docs/AI_AGENT_SPEC.md`。**接口：** `projectOraclePresentation(session: OraclePublicSession, locale: OraclePresentationResponse["locale"], catalog: readonly CatalogMaterialProduct[]): OraclePresentationResponse`；不调用熵源、不改变原 `OracleCopyService` 的持久化文案。

**Backend 子任务文件：** 修改 `apps/backend/src/modules/oracle/oracle.routes.ts`、`oracle.service.ts`、`apps/backend/src/modules/design/design.routes.ts`、`design-api.service.ts`、`docs/governance/CANONICAL_COMPONENTS.md` 中只读投影权威段及对应测试。**接口：** Oracle/Design 两个 owner-scoped GET；Design 投影从已保存 `PublicDesignV1`、可售目录和经审校模板构造。历史自由文本若无译文，使用忠于结构事实的短模板，不声称逐字翻译；不持久化翻译结果，不更改源 revision。

**Tarot 子任务文件：** 修改 `apps/backend/src/modules/tarot` 中现有 session GET 路由/服务及相邻测试，更新 `docs/API_SPECIFICATION.md` 的 Tarot 段。**接口：** owner-scoped Tarot presentation GET；只读已有牌阵、卡牌与设计事实，使用人工审校三语模板，不重抽牌、不重做推荐，返回任务 2 DTO。

- [ ] AI 写失败测试：相同会话三语均可读且 cast/recommendations 不变；无疗效/保证词；零库存材料不被虚构。运行 AI 单测，确认红因。
- [ ] AI 实现模板与投影，运行 `pnpm --filter @mystcrag/ai-agent test`/typecheck，提交 `feat(ai): project original three-language Oracle copy`。
- [ ] Backend 写失败路由测试：401/403、旧会话、三语、重复 GET、价格与 revision 不变；运行相关 Backend 测试，确认红因。
- [ ] Backend 实现 owner-scoped 只读路由，运行目标测试、typecheck、架构测试，提交 `feat(backend): serve localized design projections`。
- [ ] Tarot 写失败测试：三语反思文案可读、401/403、历史会话投影、同一牌阵/推荐 ID/revision 不变；实现只读路由并运行 Tarot 相邻测试、typecheck、架构测试，提交 `feat(tarot): serve localized card presentation`。

### 任务 4：全部页面与动态内容消费（按页面族登记 Qwen 3.8 Flash / `FRONTEND` 任务，先共享 API 消费、后逐族页面；与 Oracle/工作台任务按共同文件串行）

**文件：** 修改 `apps/frontend/src/lib/api/oracle-api.ts`、`design-api.ts` 与测试；按页面族逐一修改 `apps/frontend/app/page.tsx`、`apps/frontend/src/features/oracle/components/oracle-result.tsx`、`apps/frontend/src/features/design/components/diy-editor.tsx`、`design-results.tsx`、`apps/frontend/src/features/library/components/crystal-library-page.tsx`、`apps/frontend/src/features/gallery/components/gallery-page.tsx`、`apps/frontend/src/features/profile/components/profile-page.tsx`、Tarot/AI 客户组件、404/错误/加载/通知组件及相邻测试。与 Oracle/工作台视觉任务串行合并；不得并发锁定同一文件。

**接口：** `oracleApi.presentation(sessionId, locale)`、`designApi.presentation(designId, locale)`、`tarotApi.presentation(sessionId, locale)` 使用任务 2 DTO；显示文案从 `useDisplayLocale()` 与投影读取，设计对象仍来自原权威 API。请求取消或序号保护阻止快速切换的旧语言响应覆写新语言。

- [ ] 为每个页面族先加失败测试：标题/导航/按钮/表单/帮助/状态/404 三语覆盖；Oracle/Tarot 切换只有 GET、抽卦/抽牌不重做；空托盘仍为空且历史选择不丢；三语故事与真实 SKU、价格并存；快速切换只显示最后所选语言。
- [ ] 运行相邻 `tsx --test`，确认每组红因再逐组替换硬编码文案；品牌名与 SKU 原样保留。
- [ ] 运行前端 typecheck/lint、相邻测试与三语浏览器主链路；人工审校全部文案，并测 320 px/200% 与 1440×560。
- [ ] 提交按页面族拆开的 Conventional Commits；各次提交只触碰对应登记任务路径。

**交接门槛：** QA 用已有会话、历史设计、两个用户、三语言与两种货币核查展示-only 语义；`pnpm validate`、架构测试、`git diff --check` 通过。管理员界面至少完成基础操作与状态文案，人工录入正文不被静默翻译。
