# Knowledge-Driven Design System Specification

> 状态：**APPROVED（2026-08-20 项目所有者批准「批准架构，开始实施」）**，登记为 `DEC-KNOWLEDGE-SYSTEM-001`。
> 本文档是知识系统域的控制性规范（controlling specification），ADR 条目见 §15 并已登记入 `DECISION_LOG.md`。
> 依据：《玄矶 Mystcrag：知识驱动水晶 DIY 设计系统完整开发任务书》（2026-08-20）。

## 1. 目标与范围

在现有 Mystcrag monorepo 上建立可解释、可测试、可持续扩展的设计链：

```
Context（问卷 / 手动 / 塔罗）→ Knowledge Core → 检索 → Rule Compiler
  → Active Decision Rules → 商品/库存约束 → Design Engine → 现有 DesignV1
  → Validator → DIY（2.5D 编辑 + Three.js 预览）→ 评分 / 推荐 / 优化
```

核心原则（任务书 §66）：Product / Knowledge / Context / Decision Engine / Design Engine / DesignV1 / Three.js / MCP 职责严格分离；主链不依赖生成式 LLM；塔罗仅为 Soft Cultural Context；不重复造轮子。

## 2. Current Architecture Audit（仓库审计结论）

审计方法：通读 `AGENTS.md`、`docs/`（INDEX/PROJECT_CONTEXT/PRODUCT_REQUIREMENT/MVP_DEVELOPMENT_PLAN/API_SPECIFICATION/DATABASE_SCHEMA/AI_AGENT_SPEC/DESIGN_CONTRACT_V1/DECISION_LOG/ENGINEERING_GUIDE/DEPENDENCY_DECISIONS/SECURITY_AND_PRIVACY/LOCAL_DEMO_GUIDE）与全部相关源码（design-contract 17 个 schema、Prisma schema + 2 个 migration + seed、ai-agent 全管线、backend design 模块、bracelet-engine、three-engine、frontend 路由与 DIY 编辑器、tarot 原型与 spec/plan、tests + CI）。

### 2.1 现有模块与职责

| 模块 | 职责 | 与知识系统的关系 |
| --- | --- | --- |
| `packages/design-contract` | DesignV1 / API DTO / 目录 / 订单快照等全部 Zod 契约，前后端共享 | **扩展**：新增 taxonomy / context / knowledge / rule / trace schema |
| `packages/ai-agent` | 规则型推荐管线（emotion→crystal→pricing→design→compliance 五 Agent，fixture 驱动，输出恰好 3 候选） | **收窄复用**：保留为「解释文案 / 偏好候选」层；权威 SKU 决策移出 |
| `packages/database` | Prisma + PostgreSQL，12 模型 7 仓储，快照式库存，乐观锁，不可变修订/订单快照 | **扩展**：Product V2 列 + knowledge 表族 + pgvector |
| `packages/bracelet-engine` | 零依赖几何内核：环形布局（二分求半径）、角度命中、130–200mm 拟合门 | **复用**：`BraceletComponentInput.widthMm` 已支持任意串长，接 `lengthAlongStringMm` |
| `packages/three-engine` | DesignV1 → 场景描述符 → R3F InstancedMesh 渲染 | **零改动**：输入仍是 DesignV1 |
| `apps/backend` | Fastify + Zod，`DesignApplicationService` 唯一编排点，Bearer 鉴权，错误信封 | **扩展**：knowledge / design-engine / tarot 模块接入 |
| `apps/frontend` | Next.js 16：问卷 → 三方案 → DIY 编辑器（2D + 3D 预览）→ 下单 | **扩展**：建议面板 / 评分 / 优化 / 塔罗路由；不引入任何引擎 runtime |
| `tests/` + CI | node:test（无第二框架），架构边界 7 条不变量 + 生命周期测试；CI 四道门禁 + PG17 实库验证 | **复用**：新边界规则追加进 `architecture.test.mjs` |

### 2.2 存在冲突的旧设计 / 设计债（审计发现，未修改）

1. **CatalogMaterialProduct 双重定义**：design-contract Zod DTO（`beadProductId`/`displayName`/assetKey 必填）与 database 仓储 TS 类型（`id`/`name`/assetKey 可空）同名不同构 → EPIC 2 统一。
2. **AiDesignCandidateSchema 双定义**：backend 本地副本（materialProductIds 形态）与 ai-agent 包内 schema（components 形态）同名不同构 → EPIC 9 收敛为单一契约。
3. **预算双轨脱节**：crystal-agent 用 fixture `catalogPriceMinor` 筛选，真实目录价由 PricingRepository 重算，**无最终「总价 ≤ 预算」硬校验**；无预算时回退硬编码 100_000 分 → 新 P2 Hard Rule 修复。
4. **emotion-agent 子串匹配**：`includes` 命中意味着 "uncalm" 之类误报 → Taxonomy 规范化替代。
5. **串长近似**：手围拟合以直径近似串长，隔珠/桶珠/异形珠不成立 → Product V2 `lengthAlongStringMm` + bracelet-engine 输入语义扩展。
6. **塔罗 worktree 在途**：`.worktrees/tarot-guided-integration/` 存在进行中的塔罗实现（未合并 main）；知识架构将取代其「塔罗专用打分」部分（见 §9）。
7. 原型 `prototypes/tarot-upstream` 文档漂移（Next 版本、i18n/测试栈描述失实）；seed 配件缺 TWD 版本（TWD 下单选配件会触发 `INVENTORY_CHANGED`）。仅记录。

### 2.3 审计确认的确定性现状

当前推荐管线无 `Math.random`、无 Date 参与决策，关键排序均有 tie-break（`localeCompare`）——满足任务书 §18 确定性要求的基础良好；`pricing_rules.findFirst(orderBy createdAt desc)` 在同秒规则下存在理论漂移（低风险，EPIC 8 顺带修复为 `version desc`）。

## 3. Reuse Decision Matrix

| 能力 | 已有实现 / 候选 | 是否复用 | 原因 |
| --- | --- | --- | --- |
| Design Contract | `@mystcrag/design-contract` DesignV1 | **YES** | 唯一设计结果契约；仅可选字段扩展（§10） |
| Validation | Zod 4 | **YES** | 全仓已用 |
| Database | PostgreSQL 17 + Prisma 7 | **YES** | 增量迁移，旧数据不丢 |
| Vector Store | pgvector（`pgvector/pgvector:pg17` 镜像） | **YES** | 不新增 Chroma/SQLite vector/Mongo |
| Job Queue | pg-boss | **SPIKE→采用** | 复用现有 PG，不引入 Redis |
| Crawler | Crawlee（CheerioCrawler 优先） | **YES** | 不自研 crawler framework |
| Rule Evaluation | json-rules-engine | **SPIKE** | condition/all/any/not/priority 复用；weighted scoring 自建 typed layer（ADR-6） |
| Color math | Culori | **YES** | OKLCH/ΔE 不自实现 |
| MCP | `@modelcontextprotocol/typescript-sdk`（官方稳定版） | **YES** | 不自实现协议 |
| 几何内核 | `@mystcrag/bracelet-engine` | **YES** | 已支持逐组件 width/height |
| 推荐管线 | `@mystcrag/ai-agent` | **YES（收窄）** | 保留解释文案/偏好候选；权威决策移入 design-engine（ADR-2） |
| 测试框架 | node:test + tsx | **YES** | 任务书 §48 禁止第二套框架 |
| API 约定 | Bearer 鉴权 / Zod DTO / 错误信封 / minor-unit | **YES** | 新端点全部沿用 |
| 塔罗 | 2026-08-19 spec + 2026-08-20 plan + 原型 | **YES（部分）** | Task 1–4（引擎/契约/会话/API）吸收；Task 5 塔罗专用打分被知识管线取代（ADR-10） |
| Embedding | 无 | **新建接口 + SPIKE** | EmbeddingProvider 接口；transformers.js 服务端 vs 远程 API 先 benchmark（ADR-9） |

**不应新建**：第二套 Design Contract、ChromaDB、Redis、独立 Color Engine、塔罗专用 Design Engine、前端任何引擎/爬虫/embedding/MCP runtime、自研完整 Rule Engine（先 spike）。

**论证后新建**（均满足任务书 §20/§35 的三条件）：`packages/knowledge-core`、`packages/design-engine`、`packages/knowledge-ingestion`、`apps/knowledge-worker`、`apps/mcp-server`、`packages/tarot-engine`（原塔罗 spec 已定）。

## 4. Target Architecture

### 4.1 数据流

```
[问卷] [手动] [塔罗(tarot-engine)]          ← Context Resolver（EPIC 7，统一入口）
        └──────── RecommendationContext（单一 Schema）────────┘
                      ↓
Knowledge Core（packages/knowledge-core）
  searchKnowledge / getRules / getMaterialCompatibility / getColorRules / getDesignFormula
  ├─ 结构化过滤（taxonomy refs）
  ├─ 关键词（PG FTS，英文；中文走 taxonomy 标签 + 向量）
  ├─ 语义（pgvector，可选，失败降级）
  └─ Hybrid Rank（RRF）
                      ↓
Rule Compiler（knowledge-core 内）：相关性过滤 → 状态=APPROVED → 来源可信度
  → 库存/目录可行性 → 去重（fingerprint）→ 冲突检测 → 优先级排序 → Active Decision Rules
                      ↓
Design Engine（packages/design-engine，纯确定性）
  Candidate Selection → Allocation → Quantity → Layout(2–4 策略) → Scoring → Constraint Validation
                      ↓
  DesignV1（唯一结果契约）+ DesignDecisionTrace（sidecar）
                      ↓
Backend 编排（沿用 DesignApplicationService 模式）→ 定价/库存/合规 → 落库
                      ↓
Frontend DIY（2.5D 编辑 + three-engine 预览；评分/建议/优化面板；仅收 JSON）
```

### 4.2 依赖图（目标态）

```
design-contract（+taxonomy/context/knowledge/rule/trace schemas）
   ▲            ▲              ▲
bracelet-engine │        knowledge-core ──► database（knowledge/product 仓储 + pgvector）
   ▲            │              ▲
   │            └── design-engine ──► design-contract（+culori）
   │                   ▲
three-engine      backend ──► ai-agent（文案/偏好）、knowledge-core、design-engine、database
   ▲                 ▲
   └── frontend      mcp-server（官方 SDK）──► knowledge-core、design-engine
                    knowledge-worker ──► knowledge-ingestion（+crawlee、pg-boss）──► knowledge-core、database
```

架构边界（新增进 `tests/architecture.test.mjs`）：frontend 禁止导入 knowledge-core / design-engine / database / knowledge-ingestion / mcp-server；mcp-server 禁止 import Prisma Client（只能经 knowledge-core / design-engine）；ai-agent 不得 import database。

### 4.3 新模块边界

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| `packages/knowledge-core` | 检索（结构化+FTS+向量+RRF）、Rule Compiler、知识查询门面 | design-contract、database |
| `packages/design-engine` | 候选选材/分配/数量/布局/评分/校验/优化，输出 DesignV1 草稿 + trace | design-contract、culori |
| `packages/knowledge-ingestion` | SourceRegistry、Crawlee 适配、解析、抽取、去重（纯库） | knowledge-core、crawlee |
| `apps/knowledge-worker` | pg-boss 任务执行（fetch/parse/extract/embed/review），独立进程 | knowledge-ingestion、pg-boss |
| `apps/mcp-server` | MCP 工具暴露（search_knowledge / get_rules / get_material_compatibility / recommend_palette / evaluate_design），零业务逻辑 | 官方 SDK、knowledge-core、design-engine |
| `packages/tarot-engine` | 牌目录/牌阵/加密随机源/会话纯逻辑 + 逐牌 designTags（原塔罗 spec Task 1） | 零依赖 |

## 5. Schema Foundation（EPIC 1，全部入 design-contract，contract test 先行）

### 5.1 Taxonomy（`schemas/taxonomy.schema.ts`）

- `TaxonomyTermSchema`：`{ id（canonical，如 "color:cool"）, domain（enum：MATERIAL/COLOR/STYLE/EMOTION/TEXTURE/TRANSPARENCY/LUSTER/TEMPERATURE/COMPOSITION_ROLE/KNOWLEDGE_DOMAIN/CONTEXT_SOURCE）, displayName{zh,en}, aliases[{locale,value}], parentId?, status }`。
- canonical 数据集以**版本化 TS fixture** 形式随包发布（`TAXONOMY_VERSION = "taxonomy-2026-08-v1"`），运行时 `resolveTaxonomyId(raw, domain)` 做别名归一。V1 不建 taxonomy 数据库表（数据非用户数据、需随代码原子发布）；DB 化留待 Admin UI 需求出现时再议（ADR-3）。
- 迁移策略：现有 Crystal 的 `colorTags/styleTags/emotionTags` 与 ai-agent `STANDARD_*_TAGS` 在 EPIC 1 建立**旧值 → canonical ID 映射表**，EPIC 2 起目录数据写入 canonical 值；旧值读取时经映射兼容。

### 5.2 RecommendationContext（`schemas/recommendation-context.schema.ts`）

```
{ contextId, locale, currency,
  sources: [{ sourceType: QUESTIONNAIRE|MANUAL|TAROT（未来 ASTROLOGY|FIVE_ELEMENTS|STYLE_TEST）,
              weight（默认 TAROT=soft，≤1）, refId? }],
  hardConstraints: { wristCircumferenceMm, targetInnerCircumferenceMm?, maxBudgetMinor?,
                     requiredProductIds?, excludedProductIds, mustKeepComponentIds? },
  preferences: { emotionTags[taxonomy], styleTags[taxonomy], colorPreferences[taxonomy], visualPreferences },
  avoidances: { materialIds?, colorFamilyIds? },
  contextWeights }
```

现有 `GenerateDesignRequest` 保持不变并成为 QUESTIONNAIRE 源的投影（后端内部转换），前端既有流程零改动。

### 5.3 Knowledge Schema（`schemas/knowledge.schema.ts`）

- `KnowledgeRuleSchema`：`{ id, knowledgeType（enum：COLOR_THEORY/MATERIAL_COMPATIBILITY/STYLE_RULE/PROPORTION_RULE/COMPOSITION_RULE/TRANSITION_RULE/FOCAL_RULE/NEGATIVE_RULE/CULTURAL_SYMBOLISM/TAROT/MARKET_OBSERVATION）, knowledgeDomain, subject（taxonomyRef）, predicate/relation, payload（Json，按 type 判别联合）, conditions（Json）, confidence(0–1), status, sourceRefs[{sourceId, documentId?}], version, fingerprint }`。
- 状态机（§12 任务书）：`NEW → EXTRACTED → VALIDATED → NEEDS_REVIEW → APPROVED | REJECTED | CONFLICTED | SUPERSEDED`；**仅 APPROVED 可入生产 Rule Compiler**（仓储层强制）。
- `KnowledgeSourceSchema`：`{ id, name, sourceType（OFFICIAL_API/RSS/STATIC_HTML/BROWSER_AUTOMATION/BOOK/MANUAL）, baseUrl, enabled, authorityScore, allowedKnowledgeDomains[], crawlFrequency, language, rateLimit, legalNote }`。
- `KnowledgeDocumentSchema`：`{ id, sourceId, url(normalized), contentHash, title, fetchedAt, parser, language, status }`。
- Provenance 铁律：规则必须引用 Source/Document；`source = AI` 不可作为最终来源（AI 只能产出 NEEDS_REVIEW 候选）。

### 5.4 DecisionRule（`schemas/decision-rule.schema.ts`）

`{ id, type, priority（P0–P8，沿用任务书 §17 层级）, hardness（HARD/SOFT）, conditions（json-rules-engine 兼容 AST，待 Spike 确认，见 ADR-6）, action{kind, params}, weight, confidence, knowledgeRefs[], contextRefs[] }`。

Hard 典型：库存有效、SKU active、硬预算、mustKeep 不删、手围满足、模型资源存在。Soft 典型：邻近色优先、主材比例、塔罗象征偏好。优化目标：**100% Hard 满足下最大化 Σ SoftRuleScore**。

### 5.5 DesignDecisionTrace（`schemas/decision-trace.schema.ts`，sidecar，见 ADR-1）

`{ traceId, designId, revision, knowledgeVersion, productCatalogVersion, decisionRuleSetVersion, layoutStrategy, activeRuleIds[], knowledgeRefs[], contextRefs[], scores{color,material,style,composition,constraint,overall,formulaVersion}, warnings[], createdAt }`。不保存隐藏推理/prompt/私人对话。

## 6. Product Schema V2（EPIC 2）

扩展（不重建商品体系），全部为**可空/可选增量**，旧数据不丢：

| 表 | 新增 | 说明 |
| --- | --- | --- |
| `material_products` | `length_along_string_mm Float?`（>0 check）、`hole_diameter_mm Float?`、`grade String?`、`visual_profile Json?` | 串长独立于直径（隔珠/桶珠）；VisualProfile 经 Zod 校验 |
| `accessory_products` | `length_along_string_mm Float?`、`visual_profile Json?` | 配件同样占用串长 |

`VisualProfileSchema`（design-contract）：`{ colorFamily, secondaryColorFamily?, saturationLevel(LOW/MEDIUM/HIGH), lightnessLevel, temperature(WARM/NEUTRAL/COOL), transparency(OPAQUE/TRANSLUCENT/TRANSPARENT), luster(MATTE/SOFT/BRIGHT), visualWeight(LOW/MEDIUM/HIGH), uniformity, textureComplexity }`——全部 controlled taxonomy 枚举，第一版不做实验室色值。

DTO 对齐：`CatalogMaterialProduct` 增加 `lengthAlongStringMm?`、`visualProfile?`；**统一 contract DTO 与仓储类型的字段命名**（修复 §2.2-1 设计债）。BeadV1 增加可选 `lengthAlongStringMm`（§10）。商品**不保存** tarotCards/recommendedWith/zodiac 等关系型知识（任务书 §9）。

Backfill：seed 幂等更新（现有 36 珠：ROUND 珠 `length = diameter`，FACETED 珠 `length = diameter × 1.05` 近似并标注）；配件按 dimensions 推导。E2E-3 要求的 20 材质 / 50 SKU / 多尺寸 / 部分缺货，通过扩充 seed fixture 达成。

## 7. Database Impact（EPIC 2/3/5）

### 7.1 新表（均为增量迁移，外键 Restrict，遵循既有约束风格）

| 表 | 关键列 / 约束 |
| --- | --- |
| `knowledge_sources` | 见 §5.3；`enabled` 默认 false |
| `knowledge_documents` | `content_hash` **unique**（去重）、`source_id` FK、`url_normalized`、`search_vector tsvector GENERATED`（english 配置 + GIN） |
| `knowledge_rules` | `fingerprint` **unique**（规则去重）、`status` enum、`knowledge_version_id` FK |
| `knowledge_versions` | `version` unique、status(DRAFT/PUBLISHED/RETIRED)、ruleCount、publishedAt |
| `knowledge_embeddings`（EPIC 4 建列） | `(document_id, model)` unique、`embedding vector(N)`（N 由 embedding spike 定） |
| `design_decision_traces` | `(design_id, revision_number)` unique、随修订不可变（PG 触发器，同 design_revisions 风格） |
| `tarot_sessions` / `tarot_design_recommendations` | 按已批准塔罗 spec §7（EPIC 7 落地） |

### 7.2 pgvector 与镜像

- `docker-compose.yml` 与 `.github/workflows/postgres-verification.yml` 镜像 `postgres:17-alpine → pgvector/pgvector:pg17`；迁移 `CREATE EXTENSION IF NOT EXISTS vector`。
- 向量列推迟到 EPIC 4（embedding provider spike 定维度后单独迁移），避免维度锁死。

### 7.3 pg-boss（EPIC 5）

pg-boss 自管 `pgboss` schema（其内置迁移机制），**不纳入 prisma migrate**；在 ENGINEERING_GUIDE 记录。任务：discover-source / fetch-document / parse-document / extract-knowledge / normalize-taxonomy / detect-duplicate / generate-embedding / review-conflict / publish-knowledge。要求 retry/backoff/幂等/死信/可观测（pg-boss 原生支持）。

### 7.4 已知限制（如实声明）

- **中文 FTS**：stock PG 无 zhparser，tsvector(english) 对中文无效 → 检索策略为「结构化 taxonomy 过滤（中文主路径）+ 英文 FTS + 可选向量」；zhparser 作为 future item 不阻塞。
- Product V2 backfill / 旧快照：DesignV1 旧快照不含新字段，schema 向后兼容解析（可选字段），订单快照零改动。

## 8. API Impact（EPIC 7/10，全部沿用既有约定：Bearer + Zod DTO + 错误信封）

| 端点 | 说明 |
| --- | --- |
| `POST /api/design/generate` | **不变**（问卷源投影为 Context），前端零改动 |
| `POST /api/design/recommend` | 新：接收 RecommendationContext，返回恰好 3 候选（取代前端并发 3 次 generate 的权宜做法） |
| `POST /api/design/evaluate` | 新：designId → scores + reasons（公式版本化，无 magic score） |
| `POST /api/design/optimize` | 新：designId + lockedComponentIds + 约束 → 候选优化设计 + changes + reasons；**不自动应用**，应用走既有 `/update` 操作 |
| `GET /api/design/:id/trace` | 新：决策溯源（APPROVED 规则引用 + 分数 + 布局策略） |
| `GET /api/design/suggest?materialId=` | 新：选中材质 → 候选搭配 `{material, score, reason, knowledgeRefs}`；确定性、廉价（按 catalogVersion 缓存编译规则），拖拽路径零网络请求 |
| `GET /api/knowledge/search` | 新：hybrid 检索（结构化+关键词+向量+RRF） |
| 塔罗 6 端点 | 按已批准塔罗 spec §8（sessions/select/reveal/recommendations/get/save） |

## 9. Tarot Impact（EPIC 7）

采纳已批准塔罗 spec（2026-08-19）的服务器权威会话模型与全部合规红线，但**推荐生成路径改为知识管线**（ADR-10）：

- **保留**：`tarot-engine` 纯引擎（Task 1）、design-contract 塔罗 DTO + `DesignMode.TAROT_GUIDED`（Task 2）、TarotSession 持久化（Task 3）、后端会话模块与 6 端点（Task 4）、前端三等分入口与路由（Task 8–10）、资产与授权门槛（Task 9/11）。
- **替换**：原 Task 5 `scoreTarotMaterials`（塔罗专用打分 + 40/25/15/10/10 权重）→ 塔罗结果经 Context Resolver 映射为 RecommendationContext 的 **soft preferences**（THE_STAR → emotion: calm/hopeful/renewal + style: light/ethereal，来自 knowledge TAROT 域规则），权重作为 P6 Soft Rule 进入统一 Rule Compiler；**不得为 Tarot 单独造 Design Engine**，不得覆盖 P0/P1/P2 硬约束，不得产生 deterministic fortune 声明（compliance-agent 常规拦截）。
- **在途 worktree**：`.worktrees/tarot-guided-integration/` 中会话/引擎部分可保留续作，打分部分按本节重定向；合并顺序在实施期以 DECISION_LOG 记录。

## 10. DesignV1 Impact / 兼容性（ADR-1：方案 B，sidecar）

- **DesignV1 主体零改动，schemaVersion 维持 1.0.0**。决策溯源（decisionTrace / ruleRefs / designScores / optimizationHints）存入独立 `design_decision_traces` sidecar 记录（§5.5），订单快照与 three-engine 输入完全不受影响。
- 仅有两处**加法式**扩展（旧数据均可解析，符合 DESIGN_CONTRACT_V1「可选新增走 minor」精神，不 bump schemaVersion）：
  1. `BeadV1` / `AccessoryV1` 增加可选 `lengthAlongStringMm`（缺省时 fit/layout 回退 `diameterMm`，bracelet-engine 输入语义 `widthMm = lengthAlongStringMm ?? diameterMm`，向后兼容）；
  2. `designMode` 枚举增加 `TAROT_GUIDED`（塔罗 spec 已批准）。
- `provenance.knowledgeBaseVersion` **已存在**，生成时写入 knowledgeVersion，作为 DesignV1 ↔ trace 关联锚点。
- 不创建平行 DesignPlan Schema；`toPublicDesign` 投影不含 trace（trace 经独立端点按需下发）。

## 11. Epic Plan（E2E 映射）

| Epic | 内容 | 主要交付 | E2E |
| --- | --- | --- | --- |
| **EPIC 0（本文档）** | 架构审计 + ADR 提案 + 实施计划 + **性能 baseline 采集**（next build bundle 尺寸、evaluate/retrieval 空载基准） | 本文档；baseline 数字入 §14 | — |
| EPIC 1 | Schema Foundation：taxonomy / context / knowledge / decision-rule / trace schema + 旧标签映射 + contract tests | design-contract 扩展 | — |
| EPIC 2 | Product V2：迁移 + backfill + seed 扩容（≥20 材质/50 SKU/多尺寸/部分缺货）+ DTO 对齐 | migration + seed | E2E-3 前置 |
| EPIC 3 | Knowledge Storage：4 张 knowledge 表 + 版本机制 + pgvector 扩展 + 镜像切换 | migration | — |
| EPIC 4 | Knowledge Retrieval：结构化 + FTS + 向量（embedding provider spike：transformers.js vs 远程 API benchmark）+ RRF hybrid + 10k 基准 | 检索 + benchmark | E2E-2 前置 |
| EPIC 5 | Ingestion：SourceRegistry + Crawlee 适配 + pg-boss + Raw/Clean pipeline + 去重 | knowledge-ingestion + worker | **E2E-1** |
| EPIC 6 | Normalize / Review / Import：taxonomy 归一、抽取、校验、冲突检测、审核（Admin API + CLI）、发布版本 | 审核链路 | **E2E-2** |
| EPIC 7 | Context Resolver：问卷/手动/塔罗统一（tarot-engine + 会话 + 端点） | 统一入口 | E2E-4 前置 |
| EPIC 8 | Decision Engine：Rule Compiler（json-rules-engine spike → 采用/放弃 ADR）+ Hard/Soft + Priority + Weight + 冲突解决 + 确定性测试（100 次） | Active Rules | **E2E-2** |
| EPIC 9 | Design Generation：design-engine（选材/分配/数量/布局 2–4 策略/评分/校验）→ DesignV1 + sidecar trace；ai-agent 收窄为解释层 | design-engine | **E2E-3** |
| EPIC 10 | DIY Integration：recommend/evaluate/optimize/suggest/trace 端点 + 建议面板 + 应用/撤销优化；不重写 Three.js | DIY 四能力 | — |
| EPIC 11 | MCP：官方 SDK + 5 工具（复用 knowledge-core / design-engine，结果一致性测试） | mcp-server | — |
| EPIC 12 | Observability：规则使用次数 / 推荐结果 / 是否应用/修改/保存（只采集） | 反馈数据 | **E2E-4**（塔罗全链） |

每 Epic 遵循：worktree 隔离 → TDD（RED→GREEN→REFACTOR）→ 窄测试 → typecheck → `pnpm validate` → Conventional Commits（如 `feat(knowledge): ...`）→ Epic 后 review。

## 12. Risk Register

| # | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| R1 | pgvector 镜像/扩展不可用（compose + CI 双处） | 中 | EPIC 3 一次性切换 `pgvector/pgvector:pg17`，CI 先行验证；扩展失败不阻塞主链（检索降级） |
| R2 | 中文 FTS 缺失（无 zhparser） | 中 | taxonomy 结构化过滤为中文主路径；FTS 仅英文；向量补语义；如实写入 Known Limitations |
| R3 | json-rules-engine 不满足 weighted scoring | 中 | Spike 先行（ADR-6）；预期「引擎管条件求值 + 自建 typed scoring layer」，缺口小不重写引擎 |
| R4 | Embedding provider 运维成本（模型体积/内存/启动） | 中 | A/B/C benchmark 后决策（ADR-9）；embedding 失败时结构化+关键词必须可用（降级测试） |
| R5 | Product backfill / 旧数据丢失 | 高 | 全可空增量列 + 幂等 seed + 迁移可重复部署测试（旧 Crystal/MaterialProduct/Design/OrderSnapshot 不变断言） |
| R6 | fit 数学语义变化（直径→串长）影响 130–200mm 门 | 高 | 缺省回退 diameter 保证旧行为逐字节一致；几何测试覆盖隔珠/桶珠/异形珠/混合串 |
| R7 | 塔罗在途 worktree 冲突 | 中 | §9 明确保留/替换边界；合并顺序 DECISION_LOG 登记 |
| R8 | 前端 bundle 膨胀 | 中 | 架构测试禁止 frontend 导入新引擎包；EPIC 0 采 baseline，>10% 必须解释并优化 |
| R9 | 决策非确定性 | 高 | 稳定排序 + tie-break；规则/目录/知识全部版本锚定；100 次重放测试；`pricing_rules` 排序改 `version desc` |
| R10 | 知识冷启动（E2E-2 需 ≥100 条规则） | 中 | fixture 规则集（Color/Material/Style/Proportion/Composition/Negative/Tarot 七类）随 EPIC 1/6 建 |
| R11 | 抓取合规（robots/版权/SSRF） | 高 | SourceRegistry 白名单 + 禁内网/localhost/metadata IP + rate limit + 只存摘要/短证据；Crawlee 内建 robots 支持 |
| R12 | 合规面扩大（知识文本入生产） | 高 | 全部知识文本过 compliance-agent；NEGATIVE_RULE 拦截确定性运势表述；发布前 rg 违禁词扫描 |
| R13 | pg-boss schema 与 prisma migrate 冲突 | 低 | pg-boss 自管 schema，文档化隔离 |
| R14 | 性能预算不达标（evaluate<200ms / retrieval<300ms） | 中 | benchmark 先行；不达标输出 profile + 瓶颈分析（任务书 §41 允许） |
| R15 | 塔罗资产书面授权证据缺失 | 中 | 沿用塔罗 spec：本地集成可进行，公开 flag 启用被阻断直至证据补齐 |

## 13. Test Strategy 与验收映射

框架沿用 node:test + tsx（禁新增 Jest/Vitest）；单元测试模块本地，跨包边界入 `tests/`。

| 验收域（任务书 §49–58） | 测试落点 |
| --- | --- |
| Architecture：无第二契约/无 Chroma/无 Redis/MCP 无业务副本/塔罗无独立引擎/LLM 非必需/边界清晰 | `tests/architecture.test.mjs` 扩展（依赖审计 + 导入边界）；无 provider 环境跑通主链的集成测试 |
| Taxonomy | canonical/alias/locale/非法值/重复别名 contract tests |
| Product | 无效直径/串长/孔径/价格、inactive SKU、缺 asset、visual profile 校验 |
| Migration | 旧 Crystal/MaterialProduct/Design/OrderSnapshot 保留断言；迁移可重复部署（PG17 实库，CI workflow 复用） |
| Knowledge | 无 Source 不能发布；REJECTED 不可检索；CONFLICTED 不入生产；APPROVED 可检索；版本正确；来源可追溯 |
| Ingestion | 同 URL 重复抓取/同 content hash/retry/timeout/rate limit/禁用 source/解析错误/幂等 |
| Rule | Hard>Soft；P1>P6；用户硬要求>塔罗；库存>风格；硬预算；冲突规则；weight |
| Tarot | synthetic fixture：塔罗→soft preference；不能覆盖 mustKeep/库存；无确定性命运声明 |
| Determinism | 同 Context+KnowledgeVersion+ProductVersion 连跑 100 次，rule order 与 Design 结果一致 |
| Inventory / Budget | 缺货/inactive 不入最终设计；CNY/TWD minor units；无隐式汇率；不超硬预算 |
| Geometry | lengthAlongStringMm、组件总长、手围容差、不同珠径、隔珠、异形珠 |
| Design / Evaluate / Optimize | components 顺序、role 分配、布局对称、locked 不动、DesignV1 校验、trace 完整；评分有明确公式；优化不删 locked/不超预算/不引缺货 |
| Retrieval | Golden Query Set ≥50（简/繁/英/材质/颜色/风格/组合/塔罗），改 Retriever 必跑回归 |
| MCP | tool schema/invalid input/结果与 knowledge-core 一致/stdio+HTTP/error mapping |
| API | recommend/evaluate/optimize/search：400/404/domain failure/db failure/success |
| 3D Regression | 现有 DesignV1 仍可渲染/编辑/保存/下单（既有 three-engine 测试 + 交互 P0） |
| Security | SQL 注入/URL 校验/SSRF/私网/malicious HTML/超大 payload/MCP 非法参数/admin 鉴权 |
| Performance | retrieval/compile/evaluate benchmark，baseline vs after 数字对比 |
| Regression | 每个 Epic 后 `pnpm validate` + 全部新测试 |

## 14. Performance Budget 与 Baseline

| 指标 | 预算 | Baseline（EPIC 0 采集，实施前） | After（各 Epic 完成复测） |
| --- | --- | --- | --- |
| DIY initial bundle（gzipped） | 增长 ≤10% | `.next/static` JS 产物总量（干净单次构建）：raw 1,063,701 B / **gzip 301,587 B**（2026-08-20，基线提交 `8cf5af4`，`pnpm validate` 8/8 全绿） | EPIC 1 后：raw 1,082,665 B / gzip 307,235 B（**+1.87%**，预算内）；EPIC 10 后复测 |
| Design evaluate p95 | <200ms | 现有规则推荐管线 proxy（`generateRecommendations`，空知识库，100 次）：p50=0.14ms / p95=0.43ms / max=3.44ms；API 级 generate 耗时受 DB I/O 主导，EPIC 9 benchmark 脚本补齐 | EPIC 9/10 后 |
| Hybrid retrieval p95 @10k records | <300ms（不含首次模型加载） | — | **EPIC 4 后：p50=175.4ms / p95=182.2ms / max=209.5ms**（10,000 合成文档+规则+哈希嵌入，100 次混合查询，PostgreSQL 17 + pgvector HNSW，`pnpm --filter @mystcrag/knowledge-core bench:retrieval`）**通过** |
| 交互同步链 | 禁止 crawler/embedding/ingestion | 架构测试保证 | 架构测试保证 |

Baseline 采集方式：bundle 数字来自干净单次构建（`rm -rf .next && next build`）后对 `apps/frontend/.next/static/**/*.js` 的 raw 与 gzip 总量统计（Turbopack 构建输出不含每路由尺寸列，以产物总量作为可比指标；主检出的 `.next` 含历史 dev 残留 chunk，不可比，故以 worktree 干净重建为准）；管线数字来自包内临时 `node:test` 基准探针（100 次迭代取分位，已删除）。EPIC 1 引入 taxonomy 数据（99 词项）随 design-contract 入口进入前端 bundle，增加约 5.6KB gzip；若后续逼近预算，可将知识系统 schema 拆分为子路径导出（如 `@mystcrag/design-contract/knowledge`）。

## 15. ADR List（批准后登记 DECISION_LOG.md）

| ADR | 决策 | 理由 / 被否方案 |
| --- | --- | --- |
| ADR-1 | DesignV1 兼容走**方案 B**：sidecar `design_decision_traces`，主体零改动，schemaVersion 不变 | 订单快照/前端/three-engine 零回归风险；provenance.knowledgeBaseVersion 已有锚点。否决方案 A（内嵌扩展）：strictObject 全仓共享解析，内嵌字段对旧客户端非零风险且 trace 属服务端解释数据 |
| ADR-2 | 新建 `design-engine`；ai-agent 收窄为解释/偏好层 | AI_AGENT_SPEC 信任边界：AI 不得产出权威价格/库存/序列；design-agent 现为 fixture 模板匹配，非约束驱动；MCP/worker 需复用组合逻辑 |
| ADR-3 | Taxonomy 为 design-contract 内版本化 Zod schema + TS fixture，V1 不建表 | 数据随代码原子发布、确定性；DB 化留待 Admin UI 需求 |
| ADR-4 | pgvector（独立 embeddings 表），不新增向量库 | 任务书 §23/24；维度推迟到 spike 后 |
| ADR-5 | pg-boss，不引入 Redis | 复用 PG；schema 与 prisma migrate 隔离 |
| ADR-6 | json-rules-engine Spike：管 conditions/all/any/not/priority/facts；weighted scoring 自建 typed layer | 不重写引擎；Spike 失败才允许最小自研（另立 ADR）。**实施状态（EPIC 8）**：Spike 完成（`knowledge-core/tests/engine-spike.test.ts`），结论为采用——全量编译规则可加载求值，all/any/not/facts/priority 全部可用且确定性；两个已记录适配点：裸条件根需包一层单子 `all`（求值器侧适配）、事件无权重需 typed scoring layer 回连编译规则集（DEC-KNOWLEDGE-SYSTEM-003） |
| ADR-7 | Crawlee：CheerioCrawler 默认，PlaywrightCrawler 按白名单逐 source 启用 | 任务书 §28 |
| ADR-8 | Culori 做 OKLCH/ΔE 色彩数学 | 不自实现 |
| ADR-9 | EmbeddingProvider 接口 + Spike（A: transformers.js 服务端 / B: 远程 API / C: 独立服务），中文/繁中/英文/内存/体积/启动/吞吐/准确率/部署 benchmark 后定 | embedding 失败必须降级可用。**实施状态（EPIC 4 + Quality Phase Q1）**：接口 + HashEmbeddingProvider（256 维确定性词法哈希，CJK bigram）作为永可用的基线向量通道已落地并通过 10k 基准；**Q1 落地方案 B（OpenAI 兼容远程 API）**：`SemanticEmbeddingProvider`（分批/重试/维度校验/L2 归一，可注入 fetch）+ `FallbackEmbeddingProvider`（连续 3 次失败熔断切换到 hash 基线，进程内模型一致性，从不静默混模型）+ `createEmbeddingProviderFromEnv` 统一工厂（`KNOWLEDGE_EMBEDDING_ENDPOINT/MODEL/DIMENSIONS/API_KEY`），worker 索引与 MCP 检索共用同一构造路径，`model` 列天然隔离多版本向量；`bench:semantic` 语义评测集（24 双语文档 × 30 标注查询，词法/改写双类）量化差距——hash 基线 lexical R@1=0.70 / paraphrase R@1=0.20，语义端点接入后跑同一集合即可对比验收。选 A/C（本地 transformers.js / 独立服务）仍留作部署裁决，接口即插即用 |
| ADR-10 | 塔罗并入 RecommendationContext（soft, P6），取代塔罗专用打分 | 任务书 §13/14；已批准塔罗 spec Task 1–4 保留 |
| ADR-11 | bracelet-engine 输入语义 `widthMm = lengthAlongStringMm ?? diameterMm` | 向后兼容旧行为 |
| ADR-12 | MCP 用官方 TS SDK，新建 `apps/mcp-server`，仅依赖 knowledge-core/design-engine；backend 不经 MCP | 任务书 §36/37 |
| ADR-13 | 新 API 全部沿用既有约定（design-contract Zod DTO / Bearer / 错误信封 / minor-unit） | 与 API_SPECIFICATION 对齐 |

## 16. Open Questions（批准时请一并裁决）

1. **Embedding Spike 优先序**：本地 transformers.js 优先（零外部依赖、离线）还是远程 API 优先（零运维）？——建议本地优先，benchmark 定案。
2. **MCP 传输**：stdio 还是 Streamable HTTP？——**已裁决（EPIC 11，DEC-KNOWLEDGE-SYSTEM-007）**：双传输一并交付——stdio 为缺省（本地/编辑器客户端），Streamable HTTP 无会话模式 `POST /mcp`（容器化/远程客户端，水平可扩展）；SDK 1.30 自带 Express adapter（含 DNS rebinding 防护），Fastify 兼容性核对不再需要（MCP 为独立进程，backend 不动）。
3. **审核界面形态**：Admin API + CLI（建议，V1）还是简单后台页（延后）？
4. **塔罗 worktree 处置**：按 §9 保留续作（建议）还是废弃重做？

## 17. Knowledge Quality Phase（Q0–Q5，2026-08 批准）

质量阶段目标：语义检索质量、抽取质量、人工审核闭环、语料规模、设计质量评估。每个 EPIC 走 spec → TDD RED → GREEN → review → commit。

### 17.1 已完成

| EPIC | 内容 | 提交 |
| --- | --- | --- |
| Q0 | Source Registry 生产化（编辑分类/审核状态机/抓取健康/限速/36 seed，DEC-KNOWLEDGE-SYSTEM-010） | `2234dde` |
| Q1 | Semantic Embedding 升级（方案 B OpenAI 兼容 Provider + 熔断 fallback + 统一工厂 + 语义评测集，ADR-9 更新） | `c670622` |
| Q2 | Knowledge Extraction 升级（9 类关系词表/Extractor 接口/证据溯源/标注句评测集，DEC-KNOWLEDGE-SYSTEM-011，§17.2） | 本次提交 |

### 17.2 Q2 Knowledge Extraction 升级

**目标**：自由文本抽取从"单一 `mentioned-with` 候选"升级为**可插拔 Extractor 体系 + 9 类规范关系词表 + 句级证据溯源 + 标注句评测集**，让候选规则对 Q3 审核后台可判读、抽取质量可量化回归。

**关系词表（9 类，`design-contract` 枚举强约束 relation × knowledgeType 合法组合）**：

| relation | 允许的 knowledgeType | 模式信号（中/英） |
| --- | --- | --- |
| `pairs-well-with` | COLOR_THEORY / MATERIAL_COMPATIBILITY / STYLE_RULE | 搭配、适合、协调、pairs、complements |
| `conflicts-with` | NEGATIVE_RULE / MATERIAL_COMPATIBILITY / COLOR_THEORY | 不宜、相克、冲突、conflicts、clashes |
| `avoid-exposure` | NEGATIVE_RULE / MATERIAL_COMPATIBILITY | 避免接触水/阳光/高温/汗水、avoid water/sunlight |
| `care-instruction` | MATERIAL_COMPATIBILITY | 保养、清洁、存放、clean、store、maintain |
| `symbolizes` | CULTURAL_SYMBOLISM / TAROT | 象征、寓意、代表、symbolizes、stands for |
| `suits-style` | STYLE_RULE | 风格适配、suits、in the style of |
| `proportion-of` | PROPORTION_RULE / COMPOSITION_RULE / FOCAL_RULE | 比例、主石、数量、proportion、focal |
| `transitions-to` | TRANSITION_RULE | 渐变、过渡、gradient、transition |
| `trending-in` | MARKET_OBSERVATION | 流行、趋势、上升、trending、demand |

**Extractor 接口**（`knowledge-ingestion/src/extract/`）：

- `KnowledgeExtractor { id, method: structured | pattern | semantic, extract(input) → ExtractionCandidate[] }`
- `StructuredExtractor`：结构化 feed（JSON 规则）→ `NEW` 候选（现状语义保留）
- `PatternExtractor`：句切分 + taxonomy 主体识别 + 关系模式推断 → 证据（句子 + 字符偏移）→ `NEEDS_REVIEW`
- `SemanticExtractor`：OpenAI 兼容 chat 端点（`KNOWLEDGE_EXTRACTION_ENDPOINT/MODEL/API_KEY`，未配置即休眠），LLM JSON 输出严格 Zod 校验后按关系词表过滤，只产 `NEEDS_REVIEW`（Provenance 铁律：`source = AI` 不可作为最终来源）
- 置信度策略：模式强度基线 × 来源可靠度（HIGH 1.0 / MEDIUM 0.9 / LOW 0.75），上限 0.85；模式/语义候选永不自动 APPROVE
- 来源政策在抽取层强制：FORUM / SOCIAL_OBSERVATION 来源的候选域限定 market-observation（Q0 政策的执行点），且域必须落在 `allowedKnowledgeDomains` 内

**候选 schema 升级**：`payload.extraction = { extractor, method, evidence: [{ sentence, startOffset, endOffset, documentId }] }`——审核者可定位原句（Q3 审核后台消费），偏移量可回链文档。

**标注句评测集**（`bench:extraction`）：≥40 双语标注句（每类关系 ≥3），对 PatternExtractor 计算 relation 级 precision / recall / F1 作为抽取质量回归基线；semantic 端点接入后跑同一集合对比验收。

**验收**：9 类关系全部可产出且有测试覆盖；标注句集基线入库；pipeline 走 extractor 体系；Q0 来源政策在抽取层强制；既有 ingestion 集成测试保持绿。
