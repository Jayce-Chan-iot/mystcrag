# Knowledge Quality Phase 最终交付报告

日期：2026-08-22
状态：`READY`
范围：`docs/KNOWLEDGE_SYSTEM_SPEC.md` §17（Q0–Q5，DEC-KNOWLEDGE-SYSTEM-010 ~ 014）
分支：`feat/knowledge-quality`

## 交付结论

Knowledge Quality Phase（Q0–Q5）全部完成并逐 EPIC 提交。质量阶段在 EPIC 0–12 知识系统之上补齐了五层能力：**来源治理（Q0）→ 语义检索（Q1）→ 知识抽取（Q2）→ 人工审核后台（Q3）→ 语料规模（Q4）→ 设计质量度量（Q5）**。最终 E2E A/B/C/D 在 510 条 APPROVED 规则语料（`kb-quality-phase-final`）上 47/47 全绿，四条质量基线（检索时延 / 语义检索 / 抽取 / 设计质量门禁）全部建立并可回归。

| EPIC | 内容 | 提交 |
| --- | --- | --- |
| Q0 | Source Registry 生产化（编辑分类/审核状态机/抓取健康/限速/36 seed） | `2234dde` |
| Q1 | Semantic Embedding 升级（OpenAI 兼容 Provider + 熔断 fallback + 语义评测集） | `c670622` |
| Q2 | Knowledge Extraction 升级（9 类关系词表/Extractor 接口/证据溯源/标注句评测集） | `fc895a8` |
| Q3 | Knowledge Admin / Review 后台（Admin API 10 端点 + fail-closed admin key） | `9c96d05` |
| Q4 | Corpus Bootstrap 510 规则 + 知识分层（core/taxonomy-coverage/combination） | `2b2adba` |
| Q5 | Design Quality Evaluation（golden set / eval:design 质量门禁） | `34880b4` |
| 最终验收 | E2E A/B/C/D + 质量基线 + 本报告 | 本提交 |

## 最终 E2E A/B/C/D（closed-loop 47/47）

运行方式：PostgreSQL（已迁移 + seed + `import-fixtures --publish kb-quality-phase-final`）→ backend `:4100`（signed-test auth + tarot enabled）→ MCP server `:3001`（HTTP transport）→ `pnpm closed-loop`。全程同一数据库、同一规则版本、同一设计引擎。

**A — 设计旅程（recommend → trace → evaluate → optimize → update → save → order，13 项）**

- recommend 产出 3 候选并按 overallScore 降序；
- 决策 trace 持久化：`activeRuleIds=36`、`ruleSet=ruleset-6f5dd8f62a63`——**已审核知识真实参与生产推荐**；
- evaluate 72.9 → optimize 48 个操作且锁定组件不被改写 → update 落 revision 2（25 珠）→ 二次 evaluate 67.9；
- save、price（5640 分，零 warning）、order（`PENDING` 不可变快照）全链路通过。

**B — 塔罗旅程（create → select → reveal → recommend → save，6 项）**

- 会话 `DRAWING → GUIDANCE → 揭牌（pentacles-07）→ 3 套 ranked 推荐 → SAVED`；塔罗推荐设计持久化可读。

**C — MCP 工具一致性（7 项）**

- `get_rules(COLOR_THEORY)`：MCP=90 与数据库=90 一致；
- `search_knowledge` 命中锚定 `kb-quality-phase-final` 版本；
- `evaluate_design` 双调用确定性，且与 backend evaluate 分数完全对齐（67.9 vs 67.9，Δ=0.00）——**MCP 与 API 消费同一编译规则集与同一评分器**。

**D — 知识使用事件（collect-only 可观测，16 项）**

- `recommendation.served=2`、`rule.fired=216`、`design.created/updated/saved/evaluated/optimized`、`tarot.session_saved=1` 全部落库；
- 每条事件锚定执行用户；rule 锚定事件携带 knowledge + catalog 版本（missing=0）；
- 决策 trace 存在；`knowledge_usage_events` 的 UPDATE/DELETE 被不可变触发器拒绝（append-only 成立）。

## 质量基线（可回归）

| 基线 | 命令 | 结果 |
| --- | --- | --- |
| 检索时延（1 万 embeddings，混合检索） | `bench:retrieval` | p50=230.2ms，p95=236.2ms，max=277.0ms（n=100） |
| 语义检索（hash 基线，24 文档 × 30 查询） | `bench:semantic` | lexical R@1=0.70 / R@5=0.95 / MRR=0.81；paraphrase R@1=0.20 / R@5=0.30 / MRR=0.32 |
| 抽取质量（50 标注句，9 类关系） | `bench:extraction` | pattern-extractor-v1 整体 P=1.00 / R=1.00 / F1=1.00（TP=40，FP=0，FN=0） |
| 设计质量门禁（12 场景 golden set） | `eval:design` | scenarioPassRate 100%、hardRuleSatisfaction 100%、candidateYield 100%、meanOverallScore 92.73（门禁 ≥85）、determinismVerified=true、`meetsGate=true` |

设计质量五维子分均值：material 100、composition 100、constraint 95.83、color 85.30、style 80；preferenceCoverageRate 97.9%。

**门禁敏感性已验证**：向语料注入一条 `material:quartz` HARD 冲突规则后 `meetsGate=false`——语料、编译器或设计引擎任一环节退化，评估即红（测试 `design-eval.test.ts` 锁定）。

## 验证计数

- closed-loop E2E：47/47（A/B/C/D 四段 + preflight）
- knowledge-core：113/113（含 DB 集成；无 DB 环境 90 通过 + 3 跳过）
- `pnpm validate`：15/15（lint + typecheck + test + build 全 workspace）
- knowledge-ingestion / design-engine / backend / frontend 既有套件保持绿（validate 内含）

## 决策记录

- DEC-KNOWLEDGE-SYSTEM-010：Source Registry v2（人类门控来源、限速、抓取健康）
- DEC-KNOWLEDGE-SYSTEM-011：九类关系抽取 + 句级证据溯源
- DEC-KNOWLEDGE-SYSTEM-012：审核后台 V1 形态 = Admin API + CLI（web 页延后）
- DEC-KNOWLEDGE-SYSTEM-013：三层语料 bootstrap 至 510 规则（确定性生成）
- DEC-KNOWLEDGE-SYSTEM-014：golden set 设计质量评估 + 校准门禁（阈值 85，基线 92.73，~8 分余量）

## 剩余边界（非阻断）

- `KNOWLEDGE_EMBEDDING_ENDPOINT` 未配置：生产语义 Provider 处于休眠，运行 hash fallback。paraphrase 类 R@1=0.20 恰好量化了语义升级的收益空间；接入 BGE-M3 等 OpenAI 兼容端点后用同一评测集验收。
- `KNOWLEDGE_EXTRACTION_ENDPOINT` 未配置：LLM 语义抽取器休眠，模式抽取器全量可用（基线 F1=1.00）。
- 审核 web 后台页延后（DEC-012 裁决）；Admin API + CLI 已闭环。
- 质量门禁阈值按 2026-08-22 基线校准；语料显著扩容后需重新校准 `minOverallScore`（场景级 78–90，聚合 85）。

## 复现

```bash
pnpm --filter @mystcrag/database db:migrate && pnpm --filter @mystcrag/database db:seed
DATABASE_URL=... pnpm --filter @mystcrag/knowledge-core review:cli import-fixtures --publish kb-quality-phase-final
DATABASE_URL=... BACKEND_PORT=4100 NODE_ENV=development \
  MYSTCRAG_AUTH_PROVIDER=signed-test MYSTCRAG_ENABLE_SIGNED_TEST_AUTH=true \
  MYSTCRAG_AUTH_SIGNING_SECRET=... MYSTCRAG_AUTH_ISSUER=mystcrag-dev \
  MYSTCRAG_AUTH_AUDIENCE=mystcrag-backend MYSTCRAG_TAROT_ENABLED=true \
  pnpm --filter @mystcrag/backend dev
DATABASE_URL=... MCP_TRANSPORT=http MCP_PORT=3001 pnpm --filter @mystcrag/mcp-server dev
BACKEND_URL=http://localhost:4100 MCP_URL=http://127.0.0.1:3001/mcp \
  DATABASE_URL=... pnpm closed-loop
pnpm --filter @mystcrag/knowledge-core eval:design
```
