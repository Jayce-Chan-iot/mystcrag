# Real Knowledge Acquisition Run — Phase 1 报告（Source Approval + Coverage + 首轮采集计划）

日期：2026-08-22
状态：`Phase 1 审计与来源验证完成，等待项目所有者批准首轮采集`
范围：任务书《Real Knowledge Acquisition Run》第一次执行要求（§审计 → §Source 验证 → §Coverage → §Batch Plan → §风险）
关联文档：`docs/KNOWLEDGE_SYSTEM_SPEC.md`、`docs/KNOWLEDGE_QUALITY_PHASE_REPORT.md`
机器可读 Coverage Matrix：`outputs/knowledge-acquisition/coverage-matrix-2026-08-22.json`

---

## 1. 执行摘要

- **核心发现**：当前 510 条语料中，**0 条具有外部 Evidence**——116 条人工审定规则全部锚定内部 fixture 源（`source-fixture-handbook` / `source-fixture-market`），394 条为确定性 bootstrap 生成层（不计入本轮 KPI）。本轮 KPI 基线即从零开始积累 External Evidence-backed Knowledge。
- **36 个候选 Source 已全部完成实际网络验证**（URL 可达性、robots.txt、登录/paywall/反爬、内容匹配、权威性实评）：建议 **17 APPROVE / 11 MANUAL_ONLY / 7 NEEDS_INVESTIGATION / 1 REJECT**。
- **4 个来源 URL 已失效或错误**，给出修正路径（Pictorial Key 实际路径为 `sacred-texts.com/tarot/pkt/`；Rijksmuseum 应指向珠宝研究页；Ganoksin 应指向 learning-center；BnF 应指向 Gallica 馆藏）。
- **五行 / 星座域完全没有注册来源**；Tarot 缺少覆盖 56 张小阿卡纳的可抓取公版来源；珠宝设计原理来源偏制造工艺。已调研并验证 **7 个新来源**（ctext.org 洪范公版原典、Wikisource PKT、Wikipedia 交叉验证、American Gem Society、astrologyic、fengsuihk 等）。
- **首轮建议 APPROVED Source 共 23 个**（含修正与新增），可支撑 4 个自动采集批次 + 1 个人工通道，预计产出 **200–300 篇真实 Document、500–900 条 External Evidence-backed Candidate**，满足第一轮验收目标（300+ Candidate / 100+ 人工批准）。
- **Schema/Taxonomy 存在 6 项数据采集阻断性缺口**（claimType 缺失、WUXING/ZODIAC 域不存在、MATERIAL taxonomy 仅 20 科级词条、TAROT 仅 22 大牌等），均为最小增强项，已列入 §7 待批准后实施。本轮未修改任何核心架构。

---

## 2. 现有能力审计（禁止重复实现清单确认）

| 能力 | 状态 | 位置 | 证据 |
| --- | --- | --- | --- |
| Crawler framework | ✅ 已存在 | `packages/knowledge-ingestion`（static-html + json-api fetcher、rate-limit、SSRF security、pipeline、contentHash 去重） | Q0–Q2 交付 |
| Source Registry | ✅ 已存在 | `KnowledgeSourceSchema` + `source-registry-candidates.ts`（36 seed，全部 NEEDS_REVIEW + disabled）+ Admin API source 审核端点 | Q0（DEC-010） |
| Review engine | ✅ 已存在 | `knowledge-core/src/review/`（review-service、review rules、Review Queue）+ Admin API 10 端点 + CLI（approve/reject/supersede/publish） | Q3（DEC-012） |
| Knowledge database | ✅ 已存在 | `packages/database` knowledge 表族 + pgvector | EPIC 1–3 |
| Embedding abstraction | ✅ 已存在 | OpenAI 兼容 Provider + 熔断 hash fallback（端点未配置时休眠） | Q1 |
| Extraction framework | ✅ 已存在 | structured/pattern/semantic 三类 Extractor + 9 类关系 + 句级 evidence（documentId/sentence/startOffset/endOffset）+ Evidence 服务器重确认 | Q2（DEC-011） |
| Rule Compiler / Design Engine / MCP | ✅ 已存在 | 510 规则闭链 47/47 全绿 | Quality Phase 最终验收 |
| 质量门禁 | ✅ 已存在 | `eval:design`（92.73 基线）+ bench:retrieval/semantic/extraction | Q5 |

**结论：本轮无需新建任何大型模块。** 采集所需的最小增强仅限 §7 列出的 schema/taxonomy/registry/编排项。

### 2.1 语料真实构成（实测统计）

| 层 | 规则数 | 来源 | 计入本轮 KPI |
| --- | ---: | --- | --- |
| core（人工审定手册） | 109 | `source-fixture-handbook`（内部） | ❌ 非外部 Evidence |
| core（市场观察） | 7 | `source-fixture-market`（内部） | ❌ 同上 |
| taxonomy-coverage + combination（确定性生成） | 394 | `source-fixture-bootstrap` | ❌ 任务书 §30 明确排除 |
| **External Evidence-backed** | **0** | — | **本轮从零开始** |

分域（curated / bootstrap）：color-theory 26/64、style-rule 13/71、cultural-symbolism 7/64、material-compatibility 18/46、negative-rule 13/37、tarot 9/35、proportion-rule 11/9、composition-rule 5/7、transition-rule 4/5、focal-rule 3/2、market-observation 7/54。

### 2.2 Taxonomy 现状

MATERIAL 20（均为 quartz/agate/jade 等**科级**词条，无具体水晶）、COLOR 13、STYLE 8、EMOTION 12、TAROT 22（**仅大阿尔卡纳**）、TEXTURE 9、TRANSPARENCY 3、LUSTER 3、TEMPERATURE 3、COMPOSITION_ROLE 5、SATURATION_LEVEL 3、LIGHTNESS_LEVEL 3。**WUXING / ZODIAC 域不存在。**

---

## 3. SOURCE_REGISTRY_CANDIDATES 36 个 Source 验证结果

验证方法：3 个并行 Curator 任务对全部 36 个来源逐一执行真实网络访问（页面可达性、`{origin}/robots.txt` 逐条核对、登录/paywall/反爬检测、内容与 allowedKnowledgeDomains 匹配度、基于实际页面内容的权威性实评）。**无一来源因“在 seed 文件中”而自动 APPROVE。**

### 3.1 裁决总表

| # | Source ID | 裁决 | 建议 authority | 关键发现 |
| --- | --- | --- | ---: | --- |
| 1 | source-gia-gem-encyclopedia | **APPROVE** | 0.95 | 可访问，robots 无全站禁止；宝石百科含 lore/处理/保养；GIA birthstones 页可并入抓取范围 |
| 2 | source-mindat-mineral-database | NEEDS_INVESTIGATION | 0.85→暂缓 | Cloudflare 人机验证 + robots 明确禁止 GPTBot/ClaudeBot/CCBot 等 AI 爬虫；官方 API 需 token。改道 OpenMindat API 需先确认许可 |
| 3 | source-journal-of-gemmology | **APPROVE** | 0.90 | 目录/摘要公开可抓，2026 卷期仍在更新 |
| 4 | source-igi-education | **APPROVE** | 0.85 | 教育库公开，无登录/paywall |
| 5 | source-usgs-mineral-commodity | **APPROVE** | 0.90 | 美国政府作品（public domain），统计与材料流数据 |
| 6 | source-gemdat-gemstone-pages | **APPROVE** | 0.75 | 624 宝石名/526 数据页/宝石搜索（RI/硬度/比重/荧光）；robots.txt 404（未提供），按保守限速执行 |
| 7 | source-munsell-color-education | NEEDS_INVESTIGATION | 0.65 | 验证时域名返回异常内容（疑似重定向至 Pantone 商业页），`/color-blog` 存在性需二次确认后再批 |
| 8 | source-cie-color-standards | **APPROVE**（限定范围） | 0.75 | TR/IS 付费；TN/Position Statements/Proceedings 摘要免费——仅抓免费层 |
| 9 | source-itten-art-of-color | MANUAL_ONLY | 0.70 | 版权书籍：仅页码级人工编目引用 |
| 10 | source-pantone-trend-reports | **APPROVE**（限定范围） | 0.65 | 趋势文章公开；色号/商标内容禁止入库 |
| 11 | source-color-matters-education | **APPROVE** | 0.55 | Basic Color Theory 等页面公开；站点标注版权，仅短摘录 |
| 12 | source-vam-jewellery-gallery | **APPROVE** | 0.85 | 3000+ 珠宝馆藏 + A-Z of gemstones + 珠宝史专栏；Crawl-delay: 2 |
| 13 | source-met-heilbrunn-jewelry | **APPROVE** | 0.85 | Timeline essays 公开可抓 |
| 14 | source-rijksmuseum-jewelry | **APPROVE**（修正 URL） | 0.75 | 原 URL 为泛集合页；应改指 `/en/research/.../renaissance-jewellery` 等珠宝研究页；robots 禁搜索查询参数 |
| 15 | source-ganoksin-bench-articles | **APPROVE**（修正 URL） | 0.55 | `/articles` 已 404；改用 `/learning-center/`（2500+ 文章公开层）；会员区禁止 |
| 16 | source-mjsa-articles | MANUAL_ONLY | 0.55 | Online Library（~2000 篇）主体在会员墙后，非会员 $5/页；仅人工摘录公开摘要 |
| 17 | source-art-jewelry-forum | **APPROVE** | 0.50 | robots 无限制；当代艺术珠宝评论/展览档案 |
| 18 | source-tarot-heritage-archive | **REJECT** | — | 域名已挂售（http/https 均返回域名出售页），内容不存在 |
| 19 | source-bnf-tarot-marseille | **APPROVE**（修正 URL） | 0.85 | 主站可达；实际采集应指向 Gallica 的 Marseille Tarot 数字馆藏记录 |
| 20 | source-pictorial-key-tarot | **APPROVE**（修正 URL） | 0.80 | 原 `/tar/pkt` 404；**有效路径 `https://www.sacred-texts.com/tarot/pkt/index.htm`**，1911 公版，覆盖 78 张牌（含 56 小阿卡纳），robots 允许 reference 抓取 |
| 21 | source-met-tarot-cards | **APPROVE** | 0.75 | 改用 Met Open Access collection API；tarot 与普通 playing cards 需按类目过滤 |
| 22 | source-tarot-iconography-abstracts (JSTOR) | NEEDS_INVESTIGATION | 0.55 | 摘要级内容可用，全文付费墙；robots 禁 `/stable/*` 且禁 ClaudeBot/GPTBot/CCBot |
| 23 | source-britannica-symbolism | **APPROVE** | 0.85 | 条目正文可访问（详情页有 Cloudflare，需低速）；**wuxing/zodiac 条目同站可并入 allowedDomains** |
| 24 | source-wellcome-symbol-collections | NEEDS_INVESTIGATION | 0.75 | 站点级 SEO bot 阻断 + AWS WAF CAPTCHA；仅低频人工核验后再定 |
| 25 | source-crystal-bible-lore | MANUAL_ONLY | 0.60 | 版权书籍：人工编目文化寓意，页码级引用 |
| 26 | source-mohs-hardness-chart | MANUAL_ONLY | 0.90 | 标准矿物学数据，人工编目 + 与 GIA/gemdat 交叉验证 |
| 27 | source-iucr-crystallography | NEEDS_INVESTIGATION | 0.90 | Cloudflare + 混合 OA（部分付费）；对珠宝手串用例价值有限，降优先级 |
| 28 | source-etsy-crystal-bracelet-search | MANUAL_ONLY | 0.30 | 搜索页公开 API 不可用（需 OAuth）；仅人工抽样记录聚合信号 |
| 29 | source-taobao-crystal-category | MANUAL_ONLY | 0.25 | robots 禁一切查询参数路径；类目数据需登录；仅人工抽样 |
| 30 | source-xiaohongshu-crystal-notes | MANUAL_ONLY | 0.20 | robots 对 `*` 全站 Disallow（仅放行 /explore/）；仅人工浏览观察 |
| 31 | source-reddit-r-crystals | NEEDS_INVESTIGATION | 0.50 | `top.json` 端点被网络安全拦截；需转官方 OAuth API 或人工 |
| 32 | source-reddit-r-beadwork | NEEDS_INVESTIGATION | 0.50 | 同上 |
| 33 | source-google-trends-crystal | MANUAL_ONLY | 0.30 | `/trends/api/explore` 非公开稳定 API（返回 400）；人工观察记录 |
| 34 | source-weibo-crystal-hashtag | MANUAL_ONLY | 0.15 | 话题页强制扫码登录；仅人工客户端观察 |
| 35 | source-bijuturu-design-proportions | MANUAL_ONLY | 0.65 | 内部编目：每条结论须附原始出处页码 |
| 36 | source-stringing-wear-notes | MANUAL_ONLY | 0.80 | 内部磨损实验台账：条件/批次完整记录后可用 |

**统计：APPROVE 17 / MANUAL_ONLY 11 / NEEDS_INVESTIGATION 7 / REJECT 1。**

### 3.2 权威性校准说明（任务书 §7）

所有 authority 分数为基于实际页面内容与机构性质的重新评估，非按 domain 名自动赋值。典型调整：CIE 由 0.90 下调至 0.75（免费层内容有限）、MJSA 由 0.70 下调至 0.55（会员墙）、Art Jewelry Forum 由 0.60 下调至 0.50（社群媒体属性）、pictorial-key 由 0.75 上调至 0.80（公版全文 + 78 牌完整覆盖）。

---

## 4. 缺失来源发现（新 Source，状态 DISCOVERED → NEEDS_REVIEW）

对四个空白/薄弱域执行了新来源搜索与验证（优先级遵循任务书 §6：官方机构 → 学术 → 专业机构 → 博物馆 → 行业媒体 → 设计参考 → 论坛/社交）：

| 新 Source | 覆盖缺口 | 许可 | 建议 authority | 验证结论 |
| --- | --- | --- | ---: | --- |
| **source-ctext-wuxing-classics**（ctext.org《尚书·洪范》） | WUXING 基础体系 | 公版古籍 | 0.95 | 可访问；robots 允许（Crawl-delay: 2，禁 GPTBot）；含五行原文 + Legge 英译 |
| **source-wikipedia-reference**（en.wikipedia wuxing/zodiac/tarot 条目） | WUXING / ZODIAC / TAROT 交叉验证 | CC BY-SA | 0.75 | 可访问；robots 无全站禁止；**入库须 attribution，仅提取事实+短摘录** |
| **source-wikisource-pictorial-key**（en.wikisource PKT） | TAROT 78 牌第二来源 | 公版原文 | 0.80 | 可访问；与 sacred-texts 互为交叉验证 |
| **source-american-gem-society**（americangemsociety.org / gemsociety.org） | 宝石寓意 / birthstone folklore | 版权受限（协会站） | 0.70 | birthstone-in-folklore 等文章公开 |
| **source-astrologyic-zodiac-stones** | ZODIAC_CRYSTAL_ASSOCIATION | 版权受限（商业占星站） | 0.55 | 12 星座 primary/alternate stone 对照表公开；仅作文化关联证据 |
| **source-fengsuihk-wuxing-crystals**（五行水晶全攻略） | WUXING_CRYSTAL_ASSOCIATION | 版权受限（商业站） | 0.50 | 五行→水晶对照表公开；低权威，必须与第二来源交叉 |
| 66cn.com 命理页 | WUXING_CRYSTAL_ASSOCIATION | 版权受限 | 0.45 | **不推荐第一轮采纳**（命理/商业混杂，质量不可控） |

另调研但**不采纳**：Biddy Tarot / learn-tarot.com（版权受限，MANUAL 参考）、tashvi.ai / laudanumcrafts / gemsexplained 等设计博客（权威性 0.5 以下且许可未知，列入 NEEDS_INVESTIGATION 备选池）、Project Gutenberg #58465（非 PKT，已排除）。

---

## 5. 第一轮建议 APPROVED Sources（23 个）

按知识层分组；每源均含限速与页面范围约束，全部遵循 robots.txt，禁止登录/paywall/Cloudflare 绕过。

**A. 宝石学事实层（9）**：GIA Gem Encyclopedia（0.95，含 birthstones + lore 页）、Journal of Gemmology（0.90）、IGI Education（0.85）、USGS（0.90，public domain）、gemdat（0.75）、Britannica（0.85，扩展 wuxing/zodiac 条目）、American Gem Society（0.70，新增）、Pictorial Key @ sacred-texts（0.80，修正 URL）、BnF/Gallica Marseille（0.85，修正 URL）

**B. 色彩与设计层（7）**：CIE（0.75，限 TN/PS 免费层）、Pantone 趋势（0.65，禁色号）、Color Matters（0.55）、V&A Jewellery（0.85）、Met Heilbrunn（0.85）、Rijksmuseum 珠宝研究页（0.75，修正 URL）、Ganoksin Learning Center（0.55，修正 URL）

**C. 文化关联层（5）**：Art Jewelry Forum（0.50）、Met Playing Cards API（0.75）、ctext.org 洪范（0.95，新增）、Wikipedia 交叉验证（0.75，新增，CC BY-SA）、Wikisource PKT（0.80，新增）

**D. 跨域关联层（2）**：astrologyic zodiac stones（0.55，新增）、fengsuihk 五行水晶（0.50，新增）

**MANUAL 通道（并行启用，11 个 MANUAL_ONLY 源）**：Itten / Crystal Bible / Mohs 编目 / 内部比例编目 / 内部磨损台账 / MJSA 摘要 / Reddit 人工 / Google Trends 人工 / Etsy・淘宝・小红书・微博人工抽样。

**NEEDS_INVESTIGATION 池（7 个，不进第一轮）**：Mindat（改道 OpenMindat API 待许可确认）、Munsell（URL 异常复查）、JSTOR、Wellcome、IUCr、Reddit ×2（OAuth 申请）。

---

## 6. Coverage Matrix（摘要，机器可读版见 outputs/）

| Domain | target | current(external) | curated 内部 | missing | 覆盖 Source 数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| CRYSTAL_GEMOLOGY | 60 | 0 | 0 | 60 | 5 |
| CRYSTAL_VISUAL_PROPERTIES | 60 | 0 | 0 | 60 | 3 |
| CRYSTAL_CULTURAL_SYMBOLISM | 60 | 0 | 7 | 60 | 4 |
| COLOR_THEORY | 100 | 0 | 26 | 100 | 4 |
| JEWELRY_DESIGN（含下列四子域） | 200 | 0 | 0 | 200 | 7 |
| COMPOSITION | 40 | 0 | 5 | 40 | 5 |
| PROPORTION | 40 | 0 | 11 | 40 | 4 |
| FOCAL | 30 | 0 | 3 | 30 | 4 |
| TRANSITION | 30 | 0 | 4 | 30 | 3 |
| MATERIAL_COMPATIBILITY | 200 | 0 | 18 | 200 | 6 |
| NEGATIVE_RULE | 50 | 0 | 13 | 50 | 4 |
| STYLE | 100 | 0 | 13 | 100 | 5 |
| WUXING | 25 | 0 | 0 | 25 | 3 |
| WUXING_CRYSTAL_ASSOCIATION | 60 | 0 | 0 | 60 | 2 |
| ZODIAC | 36 | 0 | 0 | 36 | 3 |
| ZODIAC_CRYSTAL_ASSOCIATION | 24 | 0 | 0 | 24 | 3 |
| TAROT | 78 | 0 | 9 | 78 | 3 |
| TAROT_SYMBOLISM | 78 | 0 | 0 | 78 | 4 |
| TAROT_CRYSTAL_ASSOCIATION | 22 | 0 | 0 | 22 | 2 |
| MARKET_OBSERVATION | 40 | 0 | 7 | 40 | 4 |

**Top 缺口**（任务书 §27）：① 60–80 种具体水晶的矿物学/视觉/寓意条目（taxonomy 也不支持）；② 珠宝设计原理 condition→recommendation→reason→negative 结构化规则（现有来源偏工艺与馆藏描述，需设计原则抽取 + 内部编目补强）；③ 五行与星座全体系及其水晶关联（域级空白）；④ Tarot 56 张小阿卡纳（taxonomy 与语料均缺）。

---

## 7. 数据采集所需最小增强（待批准，本轮未实施）

按阻断性排序，全部为既有模块内的增量修改，不新建大型架构：

1. **KnowledgeType / 知识域扩展**：`KNOWLEDGE_DOMAIN_BY_TYPE` 增加 WUXING、WUXING_CRYSTAL_ASSOCIATION、ZODIAC、ZODIAC_CRYSTAL_ASSOCIATION、TAROT_SYMBOLISM、TAROT_CRYSTAL_ASSOCIATION、CRYSTAL_GEMOLOGY、CRYSTAL_VISUAL_PROPERTIES、CRYSTAL_CULTURAL_SYMBOLISM（或以关联型 KnowledgeType + relation 承载，编译器同步兼容）。
2. **claimType 字段**：KnowledgeRuleSchema 增加 10 类枚举（SCIENTIFIC_FACT / GEMOLOGICAL_FACT / DESIGN_PRINCIPLE / DESIGN_HEURISTIC / CULTURAL_SYMBOLISM / HISTORICAL_TRADITION / WUXING_ASSOCIATION / ASTROLOGY_ASSOCIATION / TAROT_ASSOCIATION / MARKET_OBSERVATION），并进入 QA 自动检查与 Review Batch 分组维度。
3. **Taxonomy 扩展**：MATERIAL 新增 60–80 个具体水晶词条（canonical + zh/en 别名）；新增 WUXING、ZODIAC 两个域；TAROT 补 56 小阿卡纳词条。
4. **Source Registry seed 更新**：4 个 URL 修正（pictorial-key、rijksmuseum、ganoksin、bnf）、1 个 REJECT 移除（tarot-heritage）、7 个新来源以 DISCOVERED→NEEDS_REVIEW 入册、authority 校准回写。
5. **Cross-source verification 规则**：SCIENTIFIC_FACT / GEMOLOGICAL_FACT 高置信须 ≥2 独立来源（review rules 增加）。
6. **knowledge:collect 编排命令**：coverage analysis → approved source selection → crawl → extract → normalize → dedup → cross verify → conflict detection → review queue → report（复用 run-pipeline 与 pg-boss，不自动 publish）。

---

## 8. 第一轮采集 Batch Plan

所有批次共享：同一 Taxonomy（§7.3 扩展后）、同一 Knowledge Schema、同一 Source Registry、同一 Review Policy；每 Document 落库 sourceId/url/title/fetchedAt/language/contentHash/cleanText；每 Candidate 强制 Evidence 防火墙（exact sentence + offsets + 服务器重确认）。

**Batch A — 宝石学事实层（优先级最高）**
- 来源：GIA（gem-encyclopedia 40–60 宝石页 + birthstones 12 页 + lore 段落）、gemdat（60–80 常见水晶数据页）、IGI、Journal of Gemmology 摘要、USGS
- 预计 Document：100–140
- 预计 Candidate：CRYSTAL_GEMOLOGY 500–900（60–80 水晶 × 8–12 字段）、MATERIAL_COMPATIBILITY 200+（硬度/耐久/保养/处理）、CRYSTAL_CULTURAL_SYMBOLISM 60+（GIA lore + AGS folklore）
- claimType 分布：GEMOLOGICAL_FACT / SCIENTIFIC_FACT 为主，≥2 源交叉后允许高置信

**Batch B — 色彩与设计原则层**
- 来源：Color Matters、CIE TN/PS、V&A（jewellery designs / history / A-Z gemstones）、Met Heilbrunn essays、Rijksmuseum 珠宝研究页、Ganoksin learning-center、Art Jewelry Forum、Pantone 趋势
- 预计 Document：40–60
- 预计 Candidate：COLOR_THEORY 100+（harmony/temperature/visual weight 可执行化）、设计四子域 150–250、STYLE 50+、MARKET_OBSERVATION（趋势）10–20
- claimType 分布：DESIGN_PRINCIPLE / DESIGN_HEURISTIC / HISTORICAL_TRADITION

**Batch C — 五行 / 星座文化关联层**
- 来源：ctext 洪范（原典）、Wikipedia（wuxing/zodiac 交叉验证，CC BY-SA attribution）、Britannica（wuxing/zodiac）、astrologyic（zodiac stones）、fengsuihk（五行水晶）、GIA/AGS（birthstones）
- 预计 Document：25–40
- 预计 Candidate：WUXING 25–35（五要素+生克+对应）、WUXING_CRYSTAL_ASSOCIATION 60+（**多 tradition 并存，冲突标记 CONTEXT_DEPENDENT/CONFLICTED**）、ZODIAC 36+、ZODIAC_CRYSTAL_ASSOCIATION 24–36
- claimType 分布：HISTORICAL_TRADITION / WUXING_ASSOCIATION / ASTROLOGY_ASSOCIATION；**禁止** medical / guaranteed-outcome 语义（合规层已有）

**Batch D — Tarot 78 张完整层**
- 来源：sacred-texts PKT（78 牌页）、Wikisource PKT（交叉验证）、BnF/Gallica（Marseille 图像学）、Met playing cards API
- 预计 Document：85–95
- 预计 Candidate：TAROT 78×2（upright/reversed keywords）+ 身份/花色结构 ≈ 200–300、TAROT_SYMBOLISM 78+（symbolism/emotion/visual motifs/color tendencies）、TAROT_CRYSTAL_ASSOCIATION 22+（Major，经 semantic intent 中介）
- claimType 分布：TAROT_ASSOCIATION / CULTURAL_SYMBOLISM

**Manual 通道（并行，非自动）**：Reddit（OAuth 待批后转 API）、Google Trends / Etsy / 淘宝 / 小红书 / 微博人工抽样（聚合信号，无用户内容）；Itten / Crystal Bible / Mohs / 内部编目页码级人工编目。预计 MARKET_OBSERVATION 30–50 + 设计原则人工规则 30–60。

**批次顺序与依赖**：§7.1–7.4 增强合入 → Batch A（schema 就绪即跑）→ Batch C（依赖 WUXING/ZODIAC taxonomy）→ Batch D（依赖 56 小牌 taxonomy）→ Batch B（可并行 A）。每批结束输出 §27 全字段 Coverage Report，**不自动 publish**。

---

## 9. 预期知识产出（Expected Knowledge Yield）

| 验收项（任务书 §28） | 目标 | 首轮预计 |
| --- | --- | --- |
| APPROVED real Sources | 20+ | **23** |
| real Documents | 100+ | **250–335**（A 100–140 / B 40–60 / C 25–40 / D 85–95） |
| crystal/material entries | 60+ | **60–80**（GIA+gemdat 交叉） |
| External Evidence-backed Candidates | 300+ | **500–900** |
| 人工批准 External Rules | 100+ | Review Batch 按 Domain×Material×ClaimType 分组，优先审异常项（冲突/低置信），预计可批 150–300 |
| provenance + evidence | 全部 | sourceRef + documentId + evidence 句 + offsets + claimType + confidence + extractor + version（Q2 证据防火墙已强制） |

第二轮（§29）展望：累计 500+ APPROVED External Rules、50+ design quality scenarios、真实 semantic embedding（BGE-M3 端点）与 semantic extraction benchmark 接入。

---

## 10. 风险与版权限制

| # | 风险 | 等级 | 缓解措施 |
| --- | --- | --- | --- |
| 1 | **版权内容摘录**（GIA/Britannica/Pantone/协会站/商业占星站） | 高 | 仅存句级 evidence（≤500 字符）+ URL + fetchedAt；不复制整页；事实本身不受版权保护；Review 阶段人工复核摘录比例 |
| 2 | **CC BY-SA 传染性**（Wikipedia/Wikisource 包装层） | 中 | 仅提取事实与短摘录并逐条 attribution（sourceRef 保留条目 URL 与许可证标注）；不整页复制；公版原文（PKT、洪范）优先 |
| 3 | **AI 爬虫禁令**（Mindat、JSTOR robots 明禁 GPTBot/ClaudeBot/CCBot；sacred-texts 标注 ai-train=no） | 高 | 采集用途为 reference 而非模型训练，但遵守更保守解释：Mindat/JSTOR 不进第一轮；sacred-texts 仅做 reference 抓取并低频；UA 明示身份 |
| 4 | **平台反爬/登录墙**（小红书全站 Disallow、微博扫码、淘宝禁查询参数、Reddit 端点拦截、Etsy 需 OAuth） | 高 | 一律 MANUAL_ONLY 人工抽样；**禁止绕过登录/验证码/paywall/Cloudflare**（任务书 §8，与既有 SSRF/限速/robots 强制一致） |
| 5 | **商业/命理来源质量**（astrologyic 0.55、fengsuihk 0.50） | 中 | 仅产 CULTURAL claimType 候选；≥2 源交叉才可高置信；冲突并存不覆盖（任务书 §21）；UI 保留 cultural/symbolic 语义 |
| 6 | **文化误表述**（五行/星座/塔罗被写成科学事实或医疗功效） | 高 | claimType 强制 + 合规层既有禁令（medical/guaranteed-effect/deterministic-fortune）+ QA 自动检查 + 人工 Review 终审 |
| 7 | **robots.txt 变动**（gemdat 未提供 robots、站点规则随时更新） | 中 | 每批采集前重取 robots；404/异常即降级 MANUAL；抓取健康面板（Q0）监控 |
| 8 | **量 vs 质回退**（为凑数退回生成器） | 高 | 任务书 §30 禁令执行：deterministic bootstrap / LLM synthetic / template multiplication / cartesian product 全部不计入 KPI；Coverage Report 区分 external vs generated |
| 9 | **schema 扩展引入回归** | 中 | §7 增强项全部先 contract test 后实现；`eval:design` 门禁（92.73 基线）+ `pnpm validate` 在每次 publish 前强制 |
| 10 | **LLM 抽取幻觉** | 中 | LLM 仅产 KnowledgeCandidate（NEEDS_REVIEW）；Evidence 防火墙服务器重确认原文 offsets，不存在即 discard |

---

## 11. 下一步（等待所有者裁决）

1. 批准 §7 六项最小增强（1–4 为采集阻断项，5–6 为流程项）。
2. 批准 §5 的 23 个 APPROVED Source 清单与 §8 Batch Plan。
3. 批准后按 Batch A → C → D → B 顺序执行首轮采集（每批输出 Coverage Report，不自动 publish）。
4. 同步申请：Mindat OpenMindat API token、Reddit OAuth（转 NEEDS_INVESTIGATION 池为可用）。

本轮交付物：本报告 + `outputs/knowledge-acquisition/coverage-matrix-2026-08-22.json`（机器可读 Coverage Matrix）。未修改任何核心架构、schema、数据库与语料。
