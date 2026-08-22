# Knowledge Acquisition Round 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the six minimal enhancements that unblock real external-source knowledge collection (claimType + new knowledge domains + taxonomy expansion + source registry updates + cross-source verification + `knowledge:collect` orchestration), then run Batch A.

**Architecture:** All changes are incremental extensions of existing modules — `design-contract` schema/taxonomy, `knowledge-core` fixtures/review/CLI. No new packages, no crawler framework, no new database tables (claimType rides the existing `payload`-adjacent schema fields; taxonomy stays a versioned code fixture per ADR-3). Collection reuses `knowledge-ingestion` pipeline + `review:cli`.

**Tech Stack:** Zod 4, node:test + tsx, TypeScript 6, pnpm workspace.

**Spec:** `docs/KNOWLEDGE_ACQUISITION_RUN_PHASE1_REPORT.md` §7（最小增强）+ §8（Batch Plan）+ 任务书《Real Knowledge Acquisition Run》§2/§12/§16/§17/§18/§21/§26。

## Global Constraints

- 任务书 §30：禁止 deterministic bootstrap / LLM synthetic / template multiplication / cartesian product 计入 External Evidence-backed KPI。
- 任务书 §20：五行/星座/塔罗/水晶寓意不得写成 scientific fact / medical effect / guaranteed outcome；保留 cultural/traditional/symbolic 语义。
- AGENTS.md：Conventional Commits；改动前/同步更新控制性文档（本计划改 KNOWLEDGE_SYSTEM_SPEC.md 附录登记）；交付前 `pnpm validate`。
- Schema 向后兼容：510 条既有 fixture 规则不迁移、不重生成；新字段全部 optional。
- Taxonomy 是受控词表（canonical vocabulary），不是知识规则——新增词条不违反 §30 禁令。
- 证据防火墙（Q2）不变：evidence 句 + offsets + 服务器重确认。
- 测试框架 node:test，禁止第二套框架。

---

### Task 1: ClaimType + 九个新 KnowledgeType（design-contract）

**Files:**
- Modify: `packages/design-contract/src/schemas/knowledge.schema.ts:8-20`（KnowledgeTypeSchema）、`:155-172`（KnowledgeRuleSchema）、`:233-245`（KNOWLEDGE_DOMAIN_BY_TYPE）
- Test: `packages/design-contract/tests/knowledge.test.ts`

**Interfaces:**
- Produces: `ClaimTypeSchema`、`ClaimType` 类型、`KnowledgeRuleSchema.claimType?: ClaimType`、`knowledgeDomainForType()` 支持 9 个新值。下游（Task 3/4）依赖 `knowledge-domain:crystal-gemology` 等 9 个新 domain 字符串。

- [ ] **Step 1: Write the failing test**

在 `tests/knowledge.test.ts` 末尾追加：

```typescript
test("claimType accepts the ten task-book claim categories", () => {
  const claimTypes = [
    "SCIENTIFIC_FACT",
    "GEMOLOGICAL_FACT",
    "DESIGN_PRINCIPLE",
    "DESIGN_HEURISTIC",
    "CULTURAL_SYMBOLISM",
    "HISTORICAL_TRADITION",
    "WUXING_ASSOCIATION",
    "ASTROLOGY_ASSOCIATION",
    "TAROT_ASSOCIATION",
    "MARKET_OBSERVATION"
  ];
  for (const claimType of claimTypes) {
    const parsed = KnowledgeRuleSchema.safeParse({ ...validRule, claimType });
    assert.equal(parsed.success, true, `claimType ${claimType} should parse`);
  }
  const bad = KnowledgeRuleSchema.safeParse({ ...validRule, claimType: "MEDICAL_FACT" });
  assert.equal(bad.success, false);
});

test("new knowledge types map to their knowledge domains", () => {
  const cases = [
    ["CRYSTAL_GEMOLOGY", "knowledge-domain:crystal-gemology"],
    ["CRYSTAL_VISUAL_PROPERTIES", "knowledge-domain:crystal-visual-properties"],
    ["CRYSTAL_CULTURAL_SYMBOLISM", "knowledge-domain:crystal-cultural-symbolism"],
    ["WUXING", "knowledge-domain:wuxing"],
    ["WUXING_CRYSTAL_ASSOCIATION", "knowledge-domain:wuxing-crystal-association"],
    ["ZODIAC", "knowledge-domain:zodiac"],
    ["ZODIAC_CRYSTAL_ASSOCIATION", "knowledge-domain:zodiac-crystal-association"],
    ["TAROT_SYMBOLISM", "knowledge-domain:tarot-symbolism"],
    ["TAROT_CRYSTAL_ASSOCIATION", "knowledge-domain:tarot-crystal-association"]
  ] as const;
  for (const [type, domain] of cases) {
    assert.equal(knowledgeDomainForType(type), domain);
  }
});

test("existing rules without claimType stay valid (backward compatible)", () => {
  const parsed = KnowledgeRuleSchema.safeParse(validRule);
  assert.equal(parsed.success, true);
});
```

注意 import 块需补 `knowledgeDomainForType`（若未导入）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mystcrag/design-contract exec tsx --test tests/knowledge.test.ts`
Expected: FAIL（claimType 不在 schema、新 type 不存在）

- [ ] **Step 3: Write minimal implementation**

`knowledge.schema.ts`：

```typescript
export const KnowledgeTypeSchema = z.enum([
  "COLOR_THEORY",
  "MATERIAL_COMPATIBILITY",
  "STYLE_RULE",
  "PROPORTION_RULE",
  "COMPOSITION_RULE",
  "TRANSITION_RULE",
  "FOCAL_RULE",
  "NEGATIVE_RULE",
  "CULTURAL_SYMBOLISM",
  "TAROT",
  "MARKET_OBSERVATION",
  "CRYSTAL_GEMOLOGY",
  "CRYSTAL_VISUAL_PROPERTIES",
  "CRYSTAL_CULTURAL_SYMBOLISM",
  "WUXING",
  "WUXING_CRYSTAL_ASSOCIATION",
  "ZODIAC",
  "ZODIAC_CRYSTAL_ASSOCIATION",
  "TAROT_SYMBOLISM",
  "TAROT_CRYSTAL_ASSOCIATION"
]);

/** Task book §12: knowledge is not all one grade of fact. */
export const ClaimTypeSchema = z.enum([
  "SCIENTIFIC_FACT",
  "GEMOLOGICAL_FACT",
  "DESIGN_PRINCIPLE",
  "DESIGN_HEURISTIC",
  "CULTURAL_SYMBOLISM",
  "HISTORICAL_TRADITION",
  "WUXING_ASSOCIATION",
  "ASTROLOGY_ASSOCIATION",
  "TAROT_ASSOCIATION",
  "MARKET_OBSERVATION"
]);
```

KnowledgeRuleSchema 内 `confidence` 行后加：

```typescript
  claimType: ClaimTypeSchema.optional(),
```

KNOWLEDGE_DOMAIN_BY_TYPE 追加 9 项（见测试 cases）。类型导出区追加：

```typescript
export type ClaimType = z.infer<typeof ClaimTypeSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mystcrag/design-contract exec tsx --test tests/knowledge.test.ts`
Expected: PASS 全绿

- [ ] **Step 5: Commit**

```bash
git add packages/design-contract/src/schemas/knowledge.schema.ts packages/design-contract/tests/knowledge.test.ts
git commit -m "feat(knowledge): claimType field and nine acquisition knowledge types"
```

---

### Task 2: Taxonomy 扩展（WUXING/ZODIAC 域 + 68 水晶词条 + 56 小阿卡纳）

**Files:**
- Modify: `packages/design-contract/src/schemas/taxonomy.schema.ts:5-39`（域枚举 + 前缀）
- Modify: `packages/design-contract/src/taxonomy/terms.ts`（RAW_TERMS 追加）
- Test: `packages/design-contract/tests/taxonomy.test.ts`

**Interfaces:**
- Produces: `TaxonomyDomain` 新增 `"WUXING" | "ZODIAC"`；`resolveTaxonomyId("紫水晶", "MATERIAL") === "material:amethyst"`；`resolveTaxonomyId("白羊座", "ZODIAC") === "zodiac:aries"`；`resolveTaxonomyId("木", "WUXING") === "wuxing:wood"`；小阿卡纳词条 `tarot:minor-{suit}-{rank:02d}`（suit ∈ wands|cups|swords|pentacles，rank 01–14，与 tarot-engine card id `wands-01` 对齐）。

- [ ] **Step 1: Write the failing test**

`tests/taxonomy.test.ts` 追加：

```typescript
test("acquisition round-1 crystal terms resolve", () => {
  assert.equal(resolveTaxonomyId("紫水晶", "MATERIAL"), "material:amethyst");
  assert.equal(resolveTaxonomyId("amethyst", "MATERIAL"), "material:amethyst");
  assert.equal(resolveTaxonomyId("海蓝宝", "MATERIAL"), "material:aquamarine");
  assert.equal(resolveTaxonomyId("舒俱来", "MATERIAL"), "material:sugilite");
  const materialTerms = listTaxonomyTerms("MATERIAL");
  assert.equal(materialTerms.filter((t) => !t.parentId).length >= 20, true);
  assert.equal(materialTerms.length >= 88, true);
});

test("wuxing domain resolves five elements", () => {
  assert.equal(resolveTaxonomyId("木", "WUXING"), "wuxing:wood");
  assert.equal(resolveTaxonomyId("fire", "WUXING"), "wuxing:fire");
  assert.equal(listTaxonomyTerms("WUXING").length, 5);
});

test("zodiac domain resolves twelve signs", () => {
  assert.equal(resolveTaxonomyId("白羊座", "ZODIAC"), "zodiac:aries");
  assert.equal(resolveTaxonomyId("Pisces", "ZODIAC"), "zodiac:pisces");
  assert.equal(listTaxonomyTerms("ZODIAC").length, 12);
});

test("tarot minor arcana terms cover 56 cards", () => {
  assert.equal(resolveTaxonomyId("权杖王牌", "TAROT"), "tarot:minor-wands-01");
  assert.equal(resolveTaxonomyId("pentacles-07", "TAROT"), "tarot:minor-pentacles-07");
  const tarotTerms = listTaxonomyTerms("TAROT");
  assert.equal(tarotTerms.length, 78);
});

test("nine new knowledge-domain terms exist", () => {
  for (const id of [
    "knowledge-domain:crystal-gemology",
    "knowledge-domain:crystal-visual-properties",
    "knowledge-domain:crystal-cultural-symbolism",
    "knowledge-domain:wuxing",
    "knowledge-domain:wuxing-crystal-association",
    "knowledge-domain:zodiac",
    "knowledge-domain:zodiac-crystal-association",
    "knowledge-domain:tarot-symbolism",
    "knowledge-domain:tarot-crystal-association"
  ]) {
    assert.notEqual(resolveTaxonomyId(id, "KNOWLEDGE_DOMAIN"), null, `${id} should exist`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mystcrag/design-contract exec tsx --test tests/taxonomy.test.ts`
Expected: FAIL（WUXING/ZODIAC 域不存在）

- [ ] **Step 3: Write minimal implementation**

`taxonomy.schema.ts`：枚举追加 `"WUXING", "ZODIAC"`（在 `"TAROT"` 后）；前缀表追加 `WUXING: "wuxing", ZODIAC: "zodiac"`。

`terms.ts` RAW_TERMS 追加（版本升 `taxonomy-2026-08-v3`）：

```typescript
  // KNOWLEDGE_DOMAIN (acquisition round 1)
  { id: "knowledge-domain:crystal-gemology", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "水晶宝石学", en: "Crystal gemology" }, aliases: ["crystal-gemology"] },
  { id: "knowledge-domain:crystal-visual-properties", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "水晶视觉属性", en: "Crystal visual properties" }, aliases: ["crystal-visual-properties"] },
  { id: "knowledge-domain:crystal-cultural-symbolism", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "水晶文化寓意", en: "Crystal cultural symbolism" }, aliases: ["crystal-cultural-symbolism"] },
  { id: "knowledge-domain:wuxing", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "五行", en: "Wuxing" }, aliases: ["wuxing", "five-elements", "five-phases"] },
  { id: "knowledge-domain:wuxing-crystal-association", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "五行水晶关联", en: "Wuxing crystal association" }, aliases: ["wuxing-crystal-association"] },
  { id: "knowledge-domain:zodiac", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "星座", en: "Zodiac" }, aliases: ["zodiac"] },
  { id: "knowledge-domain:zodiac-crystal-association", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "星座水晶关联", en: "Zodiac crystal association" }, aliases: ["zodiac-crystal-association"] },
  { id: "knowledge-domain:tarot-symbolism", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "塔罗象征", en: "Tarot symbolism" }, aliases: ["tarot-symbolism"] },
  { id: "knowledge-domain:tarot-crystal-association", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "塔罗水晶关联", en: "Tarot crystal association" }, aliases: ["tarot-crystal-association"] },

  // WUXING
  { id: "wuxing:wood", domain: "WUXING", displayName: { zh: "木", en: "Wood" }, aliases: ["wood", "木", "甲", "乙"] },
  { id: "wuxing:fire", domain: "WUXING", displayName: { zh: "火", en: "Fire" }, aliases: ["fire", "火", "丙", "丁"] },
  { id: "wuxing:earth", domain: "WUXING", displayName: { zh: "土", en: "Earth" }, aliases: ["earth", "土", "戊", "己"] },
  { id: "wuxing:metal", domain: "WUXING", displayName: { zh: "金", en: "Metal" }, aliases: ["metal", "金", "庚", "辛"] },
  { id: "wuxing:water", domain: "WUXING", displayName: { zh: "水", en: "Water" }, aliases: ["water", "水", "壬", "癸"] },

  // ZODIAC
  { id: "zodiac:aries", domain: "ZODIAC", displayName: { zh: "白羊座", en: "Aries" }, aliases: ["aries", "白羊", "白羊座", "牡羊座"] },
  { id: "zodiac:taurus", domain: "ZODIAC", displayName: { zh: "金牛座", en: "Taurus" }, aliases: ["taurus", "金牛", "金牛座"] },
  { id: "zodiac:gemini", domain: "ZODIAC", displayName: { zh: "双子座", en: "Gemini" }, aliases: ["gemini", "双子", "双子座"] },
  { id: "zodiac:cancer", domain: "ZODIAC", displayName: { zh: "巨蟹座", en: "Cancer" }, aliases: ["cancer", "巨蟹", "巨蟹座"] },
  { id: "zodiac:leo", domain: "ZODIAC", displayName: { zh: "狮子座", en: "Leo" }, aliases: ["leo", "狮子", "狮子座"] },
  { id: "zodiac:virgo", domain: "ZODIAC", displayName: { zh: "处女座", en: "Virgo" }, aliases: ["virgo", "处女", "处女座"] },
  { id: "zodiac:libra", domain: "ZODIAC", displayName: { zh: "天秤座", en: "Libra" }, aliases: ["libra", "天秤", "天秤座", "天平座"] },
  { id: "zodiac:scorpio", domain: "ZODIAC", displayName: { zh: "天蝎座", en: "Scorpio" }, aliases: ["scorpio", "天蝎", "天蝎座"] },
  { id: "zodiac:sagittarius", domain: "ZODIAC", displayName: { zh: "射手座", en: "Sagittarius" }, aliases: ["sagittarius", "射手", "射手座", "人马座"] },
  { id: "zodiac:capricorn", domain: "ZODIAC", displayName: { zh: "摩羯座", en: "Capricorn" }, aliases: ["capricorn", "摩羯", "摩羯座", "山羊座"] },
  { id: "zodiac:aquarius", domain: "ZODIAC", displayName: { zh: "水瓶座", en: "Aquarius" }, aliases: ["aquarius", "水瓶", "水瓶座", "宝瓶座"] },
  { id: "zodiac:pisces", domain: "ZODIAC", displayName: { zh: "双鱼座", en: "Pisces" }, aliases: ["pisces", "双鱼", "双鱼座"] },
```

水晶词条（68 条，parentId 指向既有科级词条；执行时完整写入，此处列出全部 id 与别名要点）：

```typescript
  // MATERIAL — specific crystals (acquisition round 1, 68 entries)
  // Quartz family
  { id: "material:amethyst", domain: "MATERIAL", displayName: { zh: "紫水晶", en: "Amethyst" }, aliases: ["amethyst", "紫水晶", "紫晶"], parentId: "material:quartz" },
  { id: "material:citrine", domain: "MATERIAL", displayName: { zh: "黄水晶", en: "Citrine" }, aliases: ["citrine", "黄水晶", "黄晶"], parentId: "material:quartz" },
  { id: "material:rose-quartz", domain: "MATERIAL", displayName: { zh: "粉水晶", en: "Rose quartz" }, aliases: ["rose-quartz", "rose-quartz", "粉晶", "粉水晶", "玫瑰水晶", "芙蓉石"], parentId: "material:quartz" },
  { id: "material:smoky-quartz", domain: "MATERIAL", displayName: { zh: "茶水晶", en: "Smoky quartz" }, aliases: ["smoky-quartz", "smoky", "茶晶", "茶水晶", "烟晶", "烟水晶"], parentId: "material:quartz" },
  { id: "material:clear-quartz", domain: "MATERIAL", displayName: { zh: "白水晶", en: "Clear quartz" }, aliases: ["clear-quartz", "rock-crystal", "白水晶", "无色水晶"], parentId: "material:quartz" },
  { id: "material:rutilated-quartz", domain: "MATERIAL", displayName: { zh: "发晶", en: "Rutilated quartz" }, aliases: ["rutilated-quartz", "rutilated", "发晶", "金发晶", "钛晶"], parentId: "material:quartz" },
  { id: "material:phantom-quartz", domain: "MATERIAL", displayName: { zh: "幽灵水晶", en: "Phantom quartz" }, aliases: ["phantom-quartz", "phantom", "幽灵水晶", "绿幽灵", "异象水晶"], parentId: "material:quartz" },
  { id: "material:strawberry-quartz", domain: "MATERIAL", displayName: { zh: "草莓水晶", en: "Strawberry quartz" }, aliases: ["strawberry-quartz", "草莓水晶", "草莓晶"], parentId: "material:quartz" },
  { id: "material:ametrine", domain: "MATERIAL", displayName: { zh: "紫黄晶", en: "Ametrine" }, aliases: ["ametrine", "紫黄晶"], parentId: "material:quartz" },
  { id: "material:prasiolite", domain: "MATERIAL", displayName: { zh: "绿水晶", en: "Prasiolite" }, aliases: ["prasiolite", "green-quartz", "绿水晶"], parentId: "material:quartz" },
  // Chalcedony family
  { id: "material:carnelian", domain: "MATERIAL", displayName: { zh: "红玉髓", en: "Carnelian" }, aliases: ["carnelian", "红玉髓", "红玛瑙"], parentId: "material:chalcedony" },
  { id: "material:chrysoprase", domain: "MATERIAL", displayName: { zh: "绿玉髓", en: "Chrysoprase" }, aliases: ["chrysoprase", "绿玉髓", "澳洲玉"], parentId: "material:chalcedony" },
  { id: "material:onyx", domain: "MATERIAL", displayName: { zh: "缟玛瑙", en: "Onyx" }, aliases: ["onyx", "黑玛瑙", "缟玛瑙"], parentId: "material:chalcedony" },
  { id: "material:sardonyx", domain: "MATERIAL", displayName: { zh: "红缟玛瑙", en: "Sardonyx" }, aliases: ["sardonyx", "红缟玛瑙"], parentId: "material:chalcedony" },
  { id: "material:bloodstone", domain: "MATERIAL", displayName: { zh: "血玉髓", en: "Bloodstone" }, aliases: ["bloodstone", "heliotrope", "血玉髓"], parentId: "material:chalcedony" },
  { id: "material:jasper", domain: "MATERIAL", displayName: { zh: "碧玉", en: "Jasper" }, aliases: ["jasper", "碧玉"], parentId: "material:chalcedony" },
  { id: "material:moss-agate", domain: "MATERIAL", displayName: { zh: "苔玛瑙", en: "Moss agate" }, aliases: ["moss-agate", "苔纹玛瑙", "苔藓玛瑙"], parentId: "material:agate" },
  { id: "material:blue-lace-agate", domain: "MATERIAL", displayName: { zh: "蓝纹玛瑙", en: "Blue lace agate" }, aliases: ["blue-lace-agate", "蓝纹玛瑙"], parentId: "material:agate" },
  // Beryl family
  { id: "material:aquamarine", domain: "MATERIAL", displayName: { zh: "海蓝宝石", en: "Aquamarine" }, aliases: ["aquamarine", "海蓝宝石", "海蓝宝", "蓝晶"], parentId: "material:beryl" },
  { id: "material:emerald", domain: "MATERIAL", displayName: { zh: "祖母绿", en: "Emerald" }, aliases: ["emerald", "祖母绿"], parentId: "material:beryl" },
  { id: "material:morganite", domain: "MATERIAL", displayName: { zh: "摩根石", en: "Morganite" }, aliases: ["morganite", "摩根石", "粉绿柱石"], parentId: "material:beryl" },
  { id: "material:heliodor", domain: "MATERIAL", displayName: { zh: "金绿柱石", en: "Heliodor" }, aliases: ["heliodor", "golden-beryl", "金绿柱石"], parentId: "material:beryl" },
  // Feldspar family
  { id: "material:moonstone", domain: "MATERIAL", displayName: { zh: "月光石", en: "Moonstone" }, aliases: ["moonstone", "月光石", "月长石"], parentId: "material:feldspar" },
  { id: "material:sunstone", domain: "MATERIAL", displayName: { zh: "太阳石", en: "Sunstone" }, aliases: ["sunstone", "太阳石", "日光石"], parentId: "material:feldspar" },
  { id: "material:labradorite", domain: "MATERIAL", displayName: { zh: "拉长石", en: "Labradorite" }, aliases: ["labradorite", "拉长石", "光谱石"], parentId: "material:feldspar" },
  { id: "material:amazonite", domain: "MATERIAL", displayName: { zh: "天河石", en: "Amazonite" }, aliases: ["amazonite", "amazonstone", "天河石"], parentId: "material:feldspar" },
  // Garnet group
  { id: "material:almandine", domain: "MATERIAL", displayName: { zh: "铁铝榴石", en: "Almandine" }, aliases: ["almandine", "铁铝榴石", "紫牙乌"], parentId: "material:garnet" },
  { id: "material:pyrope", domain: "MATERIAL", displayName: { zh: "镁铝榴石", en: "Pyrope" }, aliases: ["pyrope", "镁铝榴石"], parentId: "material:garnet" },
  { id: "material:spessartine", domain: "MATERIAL", displayName: { zh: "锰铝榴石", en: "Spessartine" }, aliases: ["spessartine", "spessartite", "锰铝榴石", "芬达石"], parentId: "material:garnet" },
  { id: "material:hessonite", domain: "MATERIAL", displayName: { zh: "桂榴石", en: "Hessonite" }, aliases: ["hessonite", "桂榴石", "钙铝榴石"], parentId: "material:garnet" },
  // Tourmaline
  { id: "material:black-tourmaline", domain: "MATERIAL", displayName: { zh: "黑碧玺", en: "Black tourmaline" }, aliases: ["black-tourmaline", "schorl", "黑碧玺", "黑电气石"], parentId: "material:tourmaline" },
  { id: "material:watermelon-tourmaline", domain: "MATERIAL", displayName: { zh: "西瓜碧玺", en: "Watermelon tourmaline" }, aliases: ["watermelon-tourmaline", "西瓜碧玺"], parentId: "material:tourmaline" },
  { id: "material:rubellite", domain: "MATERIAL", displayName: { zh: "红碧玺", en: "Rubellite" }, aliases: ["rubellite", "红碧玺"], parentId: "material:tourmaline" },
  { id: "material:indicolite", domain: "MATERIAL", displayName: { zh: "蓝碧玺", en: "Indicolite" }, aliases: ["indicolite", "蓝碧玺"], parentId: "material:tourmaline" },
  // Organic
  { id: "material:pearl", domain: "MATERIAL", displayName: { zh: "珍珠", en: "Pearl" }, aliases: ["pearl", "珍珠"] },
  { id: "material:amber", domain: "MATERIAL", displayName: { zh: "琥珀", en: "Amber" }, aliases: ["amber", "琥珀", "蜜蜡"] },
  { id: "material:jet", domain: "MATERIAL", displayName: { zh: "煤玉", en: "Jet" }, aliases: ["jet", "煤玉", "黑玉"] },
  // Standalone minerals
  { id: "material:peridot", domain: "MATERIAL", displayName: { zh: "橄榄石", en: "Peridot" }, aliases: ["peridot", "olivine", "橄榄石"] },
  { id: "material:spinel", domain: "MATERIAL", displayName: { zh: "尖晶石", en: "Spinel" }, aliases: ["spinel", "尖晶石"] },
  { id: "material:zircon", domain: "MATERIAL", displayName: { zh: "锆石", en: "Zircon" }, aliases: ["zircon", "锆石"] },
  { id: "material:tanzanite", domain: "MATERIAL", displayName: { zh: "坦桑石", en: "Tanzanite" }, aliases: ["tanzanite", "zoisite", "坦桑石", "黝帘石"] },
  { id: "material:iolite", domain: "MATERIAL", displayName: { zh: "堇青石", en: "Iolite" }, aliases: ["iolite", "cordierite", "堇青石"] },
  { id: "material:kunzite", domain: "MATERIAL", displayName: { zh: "紫锂辉石", en: "Kunzite" }, aliases: ["kunzite", "spodumene", "锂辉石", "紫锂辉石"] },
  { id: "material:apatite", domain: "MATERIAL", displayName: { zh: "磷灰石", en: "Apatite" }, aliases: ["apatite", "磷灰石"] },
  { id: "material:turquoise", domain: "MATERIAL", displayName: { zh: "绿松石", en: "Turquoise" }, aliases: ["turquoise", "绿松石", "松石"] },
  { id: "material:malachite", domain: "MATERIAL", displayName: { zh: "孔雀石", en: "Malachite" }, aliases: ["malachite", "孔雀石"] },
  { id: "material:azurite", domain: "MATERIAL", displayName: { zh: "蓝铜矿", en: "Azurite" }, aliases: ["azurite", "蓝铜矿", "石青"] },
  { id: "material:sodalite", domain: "MATERIAL", displayName: { zh: "方钠石", en: "Sodalite" }, aliases: ["sodalite", "方钠石"] },
  { id: "material:serpentine", domain: "MATERIAL", displayName: { zh: "蛇纹石", en: "Serpentine" }, aliases: ["serpentine", "蛇纹石", "岫玉", "岫岩玉"] },
  { id: "material:prehnite", domain: "MATERIAL", displayName: { zh: "葡萄石", en: "Prehnite" }, aliases: ["prehnite", "葡萄石"] },
  { id: "material:chrysocolla", domain: "MATERIAL", displayName: { zh: "硅孔雀石", en: "Chrysocolla" }, aliases: ["chrysocolla", "硅孔雀石"] },
  { id: "material:rhodochrosite", domain: "MATERIAL", displayName: { zh: "菱锰矿", en: "Rhodochrosite" }, aliases: ["rhodochrosite", "菱锰矿", "印加玫瑰"] },
  { id: "material:larimar", domain: "MATERIAL", displayName: { zh: "拉利玛", en: "Larimar" }, aliases: ["larimar", "pectolite", "拉利玛", "针钠钙石"] },
  { id: "material:charoite", domain: "MATERIAL", displayName: { zh: "查罗石", en: "Charoite" }, aliases: ["charoite", "查罗石", "紫龙晶"] },
  { id: "material:sugilite", domain: "MATERIAL", displayName: { zh: "苏纪石", en: "Sugilite" }, aliases: ["sugilite", "苏纪石", "舒俱来"] },
  { id: "material:howlite", domain: "MATERIAL", displayName: { zh: "白纹石", en: "Howlite" }, aliases: ["howlite", "白纹石"] },
  { id: "material:unakite", domain: "MATERIAL", displayName: { zh: "绿帘花岗岩", en: "Unakite" }, aliases: ["unakite", "绿帘花岗岩"] },
  { id: "material:kyanite", domain: "MATERIAL", displayName: { zh: "蓝晶石", en: "Kyanite" }, aliases: ["kyanite", "蓝晶石"] },
  { id: "material:chrysoberyl", domain: "MATERIAL", displayName: { zh: "金绿宝石", en: "Chrysoberyl" }, aliases: ["chrysoberyl", "金绿宝石"] },
  { id: "material:alexandrite", domain: "MATERIAL", displayName: { zh: "亚历山大变石", en: "Alexandrite" }, aliases: ["alexandrite", "亚历山大变石", "变石"], parentId: "material:chrysoberyl" },
  { id: "material:danburite", domain: "MATERIAL", displayName: { zh: "赛黄晶", en: "Danburite" }, aliases: ["danburite", "赛黄晶"] },
  { id: "material:lepidolite", domain: "MATERIAL", displayName: { zh: "锂云母", en: "Lepidolite" }, aliases: ["lepidolite", "锂云母"] },
  { id: "material:opal", domain: "MATERIAL", displayName: { zh: "蛋白石", en: "Opal" }, aliases: ["opal", "蛋白石", "欧泊"] },
  { id: "material:fire-opal", domain: "MATERIAL", displayName: { zh: "火欧泊", en: "Fire opal" }, aliases: ["fire-opal", "火欧泊"], parentId: "material:opal" },
  { id: "material:tiger-eye", domain: "MATERIAL", displayName: { zh: "虎眼石", en: "Tiger's eye" }, aliases: ["tiger-eye", "tigers-eye", "tiger-eye", "虎眼石", "虎睛石"] },
  { id: "material:hawk-eye", domain: "MATERIAL", displayName: { zh: "鹰眼石", en: "Hawk's eye" }, aliases: ["hawk-eye", "hawks-eye", "鹰眼石"] },
  { id: "material:pietersite", domain: "MATERIAL", displayName: { zh: "彼得石", en: "Pietersite" }, aliases: ["pietersite", "彼得石"] },
  { id: "material:selenite", domain: "MATERIAL", displayName: { zh: "透石膏", en: "Selenite" }, aliases: ["selenite", "satin-spar", "透石膏"] },
```

小阿卡纳词条（56 条，以生成循环写入 terms.ts 尾部、RAW_TERMS 之后）：

```typescript
const MINOR_SUITS = [
  { id: "wands", zh: "权杖", en: "Wands" },
  { id: "cups", zh: "圣杯", en: "Cups" },
  { id: "swords", zh: "宝剑", en: "Swords" },
  { id: "pentacles", zh: "星币", en: "Pentacles" }
] as const;

const MINOR_RANKS = [
  { n: 1, zh: "王牌", en: "Ace" },
  { n: 2, zh: "二", en: "Two" },
  { n: 3, zh: "三", en: "Three" },
  { n: 4, zh: "四", en: "Four" },
  { n: 5, zh: "五", en: "Five" },
  { n: 6, zh: "六", en: "Six" },
  { n: 7, zh: "七", en: "Seven" },
  { n: 8, zh: "八", en: "Eight" },
  { n: 9, zh: "九", en: "Nine" },
  { n: 10, zh: "十", en: "Ten" },
  { n: 11, zh: "侍从", en: "Page" },
  { n: 12, zh: "骑士", en: "Knight" },
  { n: 13, zh: "皇后", en: "Queen" },
  { n: 14, zh: "国王", en: "King" }
] as const;

const MINOR_ARCANA_TERMS: readonly TaxonomyTermInput[] = MINOR_SUITS.flatMap((suit) =>
  MINOR_RANKS.map((rank) => ({
    id: `tarot:minor-${suit.id}-${String(rank.n).padStart(2, "0")}`,
    domain: "TAROT" as const,
    displayName: { zh: `${rank.zh}${suit.zh}`, en: `${rank.en} of ${suit.en}` },
    aliases: [
      `${suit.id}-${String(rank.n).padStart(2, "0")}`,
      `${rank.en.toLowerCase()} of ${suit.id}`,
      `${rank.zh}${suit.zh}`
    ]
  }))
);
```

然后 `export const TAXONOMY_TERMS: readonly TaxonomyTerm[] = [...]`（现有导出名按实际调整）由 `[...RAW_TERMS, ...MINOR_ARCANA_TERMS]` 构建。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mystcrag/design-contract exec tsx --test tests/taxonomy.test.ts` 与 `pnpm --filter @mystcrag/design-contract exec tsx --test tests/knowledge.test.ts`
Expected: PASS（含既有 22 大牌 78 总数断言）

- [ ] **Step 5: Run full package tests（corpus bootstrap 依赖 taxonomy，确认无回归）**

Run: `pnpm --filter @mystcrag/design-contract test && pnpm --filter @mystcrag/knowledge-core test`
Expected: PASS（knowledge-core 113/113）

- [ ] **Step 6: Commit**

```bash
git add packages/design-contract/src/schemas/taxonomy.schema.ts packages/design-contract/src/taxonomy/terms.ts packages/design-contract/tests/taxonomy.test.ts
git commit -m "feat(taxonomy): wuxing/zodiac domains, 68 crystal terms, minor arcana (v3)"
```

---

### Task 3: Source Registry seed 更新（4 URL 修正 + 1 移除 + 6 新增 + authority 校准）

**Files:**
- Modify: `packages/knowledge-core/src/fixtures/source-registry-candidates.ts`
- Test: `packages/knowledge-core/tests/source-registry-candidates.test.ts`

**Interfaces:**
- Produces: 修正后 seed 仍全部 `NEEDS_REVIEW` + `enabled: false`（Q0 不变量）；新增源含 `source-ctext-wuxing-classics` 等 6 个 id；`allowedKnowledgeDomains` 使用 Task 1/2 的新 domain 字符串。

- [ ] **Step 1: Write the failing test**

追加断言：总数 41（36 − 1 + 6）；`source-tarot-heritage-archive` 不存在；4 个修正 URL 精确匹配；新 6 源存在且域正确；全部 reviewStatus=NEEDS_REVIEW 且 enabled 缺省 false。

```typescript
test("acquisition round-1 source registry updates", () => {
  const ids = new Set(SOURCE_REGISTRY_CANDIDATES.map((s) => s.id));
  assert.equal(ids.has("source-tarot-heritage-archive"), false);
  assert.equal(ids.size, 41);
  const byId = new Map(SOURCE_REGISTRY_CANDIDATES.map((s) => [s.id, s]));
  assert.equal(byId.get("source-pictorial-key-tarot")?.baseUrl, "https://www.sacred-texts.com/tarot/pkt/index.htm");
  assert.equal(byId.get("source-ganoksin-bench-articles")?.baseUrl, "https://www.ganoksin.com/learning-center/");
  assert.equal(byId.get("source-rijksmuseum-jewelry")?.baseUrl, "https://www.rijksmuseum.nl/en/research/our-research/fine-and-decorative-arts/decorative-arts/renaissance-jewellery");
  assert.equal(byId.get("source-bnf-tarot-marseille")?.baseUrl, "https://gallica.bnf.fr");
  for (const id of ["source-ctext-wuxing-classics", "source-wikipedia-reference", "source-wikisource-pictorial-key", "source-american-gem-society", "source-astrologyic-zodiac-stones", "source-fengsuihk-wuxing-crystals"]) {
    assert.equal(ids.has(id), true, `${id} should be registered`);
  }
  assert.ok(byId.get("source-ctext-wuxing-classics")?.allowedKnowledgeDomains.includes("knowledge-domain:wuxing"));
  assert.ok(byId.get("source-astrologyic-zodiac-stones")?.allowedKnowledgeDomains.includes("knowledge-domain:zodiac-crystal-association"));
  assert.ok(byId.get("source-fengsuihk-wuxing-crystals")?.allowedKnowledgeDomains.includes("knowledge-domain:wuxing-crystal-association"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mystcrag/knowledge-core exec tsx --test tests/source-registry-candidates.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

按 Phase 1 报告 §3.1/§4 修改 seed：移除 tarot-heritage 条目；4 个 baseUrl 替换；新增 6 个条目（ctext 0.95 OFFICIAL STATIC_HTML maxPages 6 rate 6/min legalNote "公版古籍；引用原文须标注 ctext.org 出处"；wikipedia-reference 0.75 ACADEMIC STATIC_HTML legalNote "CC BY-SA：仅事实提取与短摘录，逐条 attribution"；wikisource 0.80 BOOK；american-gem-society 0.70 GEMOLOGY；astrologyic 0.55 DESIGN_REFERENCE legalNote "文化关联证据，非科学事实"；fengsuihk 0.50 INDUSTRY legalNote "商业文化对照，须与第二来源交叉"）；既有条目 authorityScore 按 §3.1 校准表回写（CIE 0.75、MJSA 0.55、AJF 0.50、pictorial-key 0.80 等）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mystcrag/knowledge-core exec tsx --test tests/source-registry-candidates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-core/src/fixtures/source-registry-candidates.ts packages/knowledge-core/tests/source-registry-candidates.test.ts
git commit -m "feat(knowledge): apply phase-1 source verdicts to registry seed"
```

---

### Task 4: Cross-source verification + claimType 审核规则

**Files:**
- Modify: `packages/knowledge-core/src/review/rules.ts:66-116`（validateKnowledgeRuleCandidate）、`classifyCandidate`
- Test: `packages/knowledge-core/src/review/rules.test.ts`（若在 tests/ 下按实际路径）

**Interfaces:**
- Produces: 校验规则——① external source（非 `source-fixture-*`）规则 `claimType` 必填；② `claimType ∈ {SCIENTIFIC_FACT, GEMOLOGICAL_FACT}` 且 confidence ≥ 0.8 时须 ≥2 个不同 sourceId；违反即 issue → NEEDS_REVIEW。

- [ ] **Step 1: Write the failing test**

构造 StoredKnowledgeRule 假对象（沿用既有测试 helper）：

```typescript
test("external-source rules require claimType", () => {
  const rule = makeRule({ sourceRefs: [{ sourceId: "source-gia-gem-encyclopedia" }] });
  const result = validateKnowledgeRuleCandidate(rule);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.includes("claimType")));
});

test("high-confidence scientific facts require two independent sources", () => {
  const one = makeRule({ claimType: "GEMOLOGICAL_FACT", confidence: 0.85, sourceRefs: [{ sourceId: "source-gia-gem-encyclopedia" }] });
  assert.ok(validateKnowledgeRuleCandidate(one).issues.some((i) => i.includes("independent")));
  const two = makeRule({ claimType: "GEMOLOGICAL_FACT", confidence: 0.85, sourceRefs: [{ sourceId: "source-gia-gem-encyclopedia" }, { sourceId: "source-gemdat-gemstone-pages" }] });
  assert.equal(validateKnowledgeRuleCandidate(two).valid, true);
});

test("single-source scientific fact is kept but capped below auto-validate", () => {
  const rule = makeRule({ claimType: "GEMOLOGICAL_FACT", confidence: 0.85, sourceRefs: [{ sourceId: "source-gia-gem-encyclopedia" }] });
  const source = makeSource({ id: "source-gia-gem-encyclopedia", authorityScore: 0.95 });
  assert.equal(classifyCandidate({ ...rule, confidence: 0.7 }, source).classification, "NEEDS_REVIEW");
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `pnpm --filter @mystcrag/knowledge-core exec tsx --test src/review/rules.test.ts`（路径按实际），Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`validateKnowledgeRuleCandidate` 追加（`StoredKnowledgeRule` 若无 claimType 字段则经 `(rule as ...)` 兼容读取——数据库实体由 ingestion 写入时携带）：

```typescript
const EXTERNAL_SOURCE_PREFIXES = ["source-fixture-"];
function isExternalSourceRef(sourceId: string): boolean {
  return !EXTERNAL_SOURCE_PREFIXES.some((p) => sourceId.startsWith(p));
}
const FACT_CLAIM_TYPES: readonly string[] = ["SCIENTIFIC_FACT", "GEMOLOGICAL_FACT"];

// in validateKnowledgeRuleCandidate:
const claimType = (rule as { claimType?: string }).claimType;
const hasExternalSource = rule.sourceRefs.some((ref) => isExternalSourceRef(ref.sourceId));
if (hasExternalSource && claimType === undefined) {
  issues.push("external-source rules must declare claimType (task book §12)");
}
if (claimType !== undefined && FACT_CLAIM_TYPES.includes(claimType) && (rule.confidence ?? 0) >= 0.8) {
  const distinctSources = new Set(rule.sourceRefs.map((ref) => ref.sourceId));
  if (distinctSources.size < 2) {
    issues.push("high-confidence SCIENTIFIC/GEMOLOGICAL facts require ≥2 independent sources (task book §19)");
  }
}
```

`classifyCandidate`：单源 FACT 类型置信上限 0.79（高于即降 NEEDS_REVIEW）。

- [ ] **Step 4: Run test to verify it passes** → **Step 5: Commit**

```bash
git commit -m "feat(knowledge): claimType gate and two-source verification for factual claims"
```

---

### Task 5: knowledge:collect 编排命令

**Files:**
- Modify: `packages/knowledge-core/src/cli/index.ts`（新 `collect` 命令）、`package.json`（`knowledge:collect` script）
- Test: `packages/knowledge-core/src/cli/collect.test.ts`（dry-run 模式无 DB 依赖）

**Interfaces:**
- Produces: `review:cli collect --dry-run` 输出 Coverage Analysis（按 domain 统计 target/current/missing + 选中的 APPROVED sources + 预计批次），非 dry-run 走 `runIngestionPipeline` 逐 approved+enabled source 执行并输出 §27 Coverage Report JSON 到 stdout；**不自动 publish**。

- [ ] **Step 1: Write the failing test** — dry-run 输出含 `"phase": "coverage-analysis"`、批次数、source 数。
- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement** — 复用 `runIngestionPipeline` + `KnowledgeReviewService.reviewPipeline`；coverage 数据读 Coverage Matrix JSON（`outputs/knowledge-acquisition/coverage-matrix-2026-08-22.json` 内嵌为 fixture 常量，避免运行时文件依赖）。
- [ ] **Step 4: Run to verify it passes** → **Step 5: Commit** `feat(knowledge): knowledge:collect orchestration command (dry-run + batch)`

---

### Task 6: Batch A 采集执行 + Coverage Report

**Files:**
- Create: `outputs/knowledge-acquisition/batch-a-coverage-report-<date>.json`
- 无代码改动；运行采集 + 审核 + 报告。

- [ ] **Step 1:** DB up + migrate + seed + import-fixtures（复现 Quality Phase 流程）
- [ ] **Step 2:** 经 Admin API 将 23 个 APPROVED 源置 APPROVED + enabled（其余保持 NEEDS_REVIEW/disabled）
- [ ] **Step 3:** `knowledge:collect` 执行 Batch A（GIA/gemdat/IGI/Gem-A/USGS 限速抓取 → 抽取 → 去重 → evidence 校验 → review queue）
- [ ] **Step 4:** 输出 §27 Coverage Report（sources crawled / documents added / duplicates skipped / candidates by domain / conflicts / coverage gaps）
- [ ] **Step 5:** `pnpm validate` + 人工 Review Batch 分组预览（不 publish）

---

## Self-Review

1. **Spec coverage**：§7.1→Task 1、§7.2→Task 1+4、§7.3→Task 2、§7.4→Task 3、§7.5→Task 4、§7.6→Task 5、§8 Batch A→Task 6。Phase 1 报告 §7 全部六项有任务对应。✔
2. **Placeholder scan**：Task 3 Step 3 描述性列出新源参数（完整数值在 Phase 1 报告 §4 表格，spec 随计划同行）；其余任务代码完整。✔
3. **Type consistency**：`claimType` 在 Task 1（schema）、Task 4（review）一致；domain 字符串 Task 1/2/3 三处一致（`knowledge-domain:wuxing` 等）；tarot minor id 格式与 tarot-engine `wands-01` 对齐经 alias 解析。✔
