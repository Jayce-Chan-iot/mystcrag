# Mystcrag Design Contract V1 现状审查

> 审查阶段：Phase 1，仅做现状分析与迁移设计，暂不实现共享 package，不替换现有接口。
> 决策状态：Design Contract V1 的六项设计决策已批准，见第 10 节。
> 审查基线：`016d3f9 chore: initialize Mystcrag project architecture`
> 审查日期：2026-07-21

## 1. 范围与结论

本次已审查 `packages/ai-agent`、`packages/three-engine`、`packages/database`、`apps/backend` 及相关规范文档，并在全仓库搜索了设计、珠子、定价、订单和社区发布类型。

结论：现有代码适合初始化脚手架，但不能直接作为生产设计协议。AI 和 3D 的珠子结构只能表达“某水晶多少颗”，无法无损支持 DIY 排序、单颗替换、3D 材质映射、实时定价和生产清单。API 文档、TypeScript 类型与 Prisma 存储层同时存在命名、金额类型和数据粒度冲突。

建议在 Phase 2 新建 `@mystcrag/design-contract`，由 Zod schema 推导 TypeScript 类型，作为设计领域模型和 API DTO 的唯一定义源。Prisma 模型仍是持久化模型，3D 场景描述仍是渲染运行时模型，二者都必须通过明确的 adapter 与设计协议转换，不应反向成为 API contract。

## 2. 当前重复类型

| 位置 | 当前定义 | 重复或重叠 | 主要局限 |
| --- | --- | --- | --- |
| `packages/ai-agent/contracts.ts` | `BeadDesign { crystalId, sizeMm, count }` | 与 3D 的 `BraceletBeadConfiguration` 字段完全重复 | 按种类分组，不保存最终顺序；无 SKU、形状、价格、材质和资产键 |
| `packages/ai-agent/contracts.ts` | `BraceletDesignOutput { designName, story, style, beads }` | 部分重叠 3D `BraceletConfiguration` 和 Prisma `DesignHistory.configuration` | 无 ID/版本/手围/时间/定价/合规/来源/发布信息 |
| `packages/three-engine/contracts.ts` | `BraceletBeadConfiguration { crystalId, sizeMm, count }` | 复制 AI `BeadDesign` | 无法选中或替换单颗珠，无法表达混排和配件 |
| `packages/three-engine/contracts.ts` | `BraceletConfiguration { designId, beads }` | 另一个设计输入模型 | 缺少内圆周长、间隙、布局、模型/纹理资产键 |
| `docs/API_SPECIFICATION.md` | `design_name`、`crystals`、`price`、`three_config` 示例 | 与 AI 的 camelCase 结构和 3D 结构重复 | 未定义 DTO，金额为字符串，`three_config` 容易演化成第三份设计协议 |
| `packages/database/prisma/schema.prisma` | `DesignTemplate.beadSequence` / `DesignHistory.configuration` JSON | 存储了未约束的设计结构 | 无 schema version，数据库无法保证写入结构，也没有读写 adapter |
| `packages/ai-agent/pricing-agent` 与 Prisma | `amount: number` / `Decimal(10,2)` | 两套金额表达 | JS `number` 接受小数，Decimal 按主币单位存储，均与“minor unit 整数”目标不一致 |

Backend 当前只有模块元数据和诊断路由，尚未定义产品 API DTO，因此没有需要删除的 Backend 设计类型；也正因如此，应在实现产品路由之前先建立共享 DTO schema。Frontend 当前没有设计领域类型。

## 3. 当前冲突与风险

### 3.1 数据粒度与顺序

- AI 和 3D 都用 `count` 聚合珠子，会丢失实际排列。例如 A-B-A 和 A-A-B 可被压缩成同一组计数。
- `sizeMm` 未说明是直径、长度还是资产标称，与目标字段 `diameterMm` 不一致。
- 现有类型没有 `positionIndex`、单颗稳定识别符或任何配件顺序定义，无法安全实现选中、交换与撤销。

### 3.2 金额与币种

- API 示例把 `budget` 和 `price` 写成字符串；AI 使用无单位 `number`；Prisma 使用 `Decimal(10,2)`。三者不能直接共用。
- `PricingAgentOutput.amount` 和 `lineItems[].amount` 没有整数约束，会引入浮点误差。
- `DesignHistory.quotedPrice`、`Material.unitPrice` 和 `Order.totalAmount` 没有币种字段。不同币种数值无法解释或审计。
- 当前数据库金额是主币单位 Decimal，V1 目标是最小币种单位整数。这需要数据库迁移而不是只改 API 序列化。

### 3.3 命名与边界

- API 示例使用 snake_case，现有 TypeScript 使用 camelCase。V1 已批准 wire JSON 与 TypeScript 统一使用 camelCase，后续实现应替换 API 文档中的 snake_case 占位示例。
- `crystalId` 是知识库矿物 ID，不能唯一确定可售 SKU、库存、尺寸、成本或价格。设计项必须同时引用 `beadProductId`/`accessoryProductId`。
- Prisma 生成类型反映表结构，包含 Decimal、relation 和内部字段，不能作为 API DTO。
- `unitCostMinor` 是敏感内部商业数据。已批准将其排除在 `DesignV1` 之外，只由服务端 `InternalCommercialDesignV1` 表达，不得进入公开设计、社区、收藏/复刻或普通前端 DTO。

### 3.4 生命周期与快照

- `DesignHistory.configuration` 只是无版本 JSON。应用层既不能确认其 schema，也无法区分无效数据与旧版数据。
- `Order` 只关联 `DesignHistory`，没有设计、定价与生产清单快照。下单后如果设计或商品价格改变，将无法重建下单时的交易内容。
- 文档把 `design_history` 称为“immutable design ownership boundary plus the latest structured configuration”，但模型同时有 `updatedAt` 并预期保存最新配置。“不可变历史”与“可更新当前设计”需要在持久化设计中拆分。
- 没有乐观并发字段；DIY 多端编辑可以彼此覆盖。

### 3.5 合规、来源与隐私

- 合规结果只有 `approved` 和自由文本 `issues`，缺少结构化状态、限制声明分类、免责键和人工复审标记。
- 无 `generatedBy`、模型/提示词/知识库/模板/定价规则版本，无法回溯 AI 输出或重现价格。
- 不应保存或传输隐藏推理链。用户可见的 `recommendationReasons` 与必要生成元数据已足够满足可追溯性。
- 数据库只有 `sharingConsent: false`，没有可见性、是否允许复刻和创作者展示模式。当前后端也没有发布不变式验证。

## 4. 缺失字段与能力

| 能力 | 当前缺失 |
| --- | --- |
| 协议元数据 | `schemaVersion`、`designId`（AI 输出缺失）、`designMode`、`createdAt`、`updatedAt`、`locale`、`currency` |
| 手串几何 | `wristCircumferenceMm`、`targetInnerCircumferenceMm`、`elasticAllowanceMm`、`braceletLayout`、`beadGapMm`、`totalBeadCount` |
| 单颗珠 | `positionIndex`、`beadProductId`、`materialKey`、`shape`、`diameterMm`、`role`、`modelAssetKey`、`textureAssetKey`、`unitPriceMinor`；内部商业视图另需 `unitCostMinor` |
| 配件 | 整个 accessory 模型：隔珠、吊坠、金属件、连接件，含 `INLINE | ANCHORED` placement、材质、表面处理、尺寸、价格与资产 |
| AI 说明 | `emotionTags`、`styleTags`、`colorPalette`、`culturalInspiration`、`designStory`、`recommendationReasons`、`sourceTemplateIds` 及文案性质标注 |
| 定价 | 全部分项、`discount`、`totalPrice`、`pricingVersion`、`priceCalculatedAt` 与库存/预算结果 |
| 生产 | 按最终顺序生成的 BOM、手围、备注、替代材料规则和展示数据追溯键 |
| 合规 | `complianceStatus`、`restrictedClaims`、`disclaimerKeys`、`reviewRequired` |
| 来源 | `generatedBy`、`modelProvider`、`modelName`、`promptVersion`、`knowledgeBaseVersion`、`designTemplateVersion`、`pricingRuleVersion` |
| 社区 | `visibility`、`publishConsent`、`allowRemix`、`creatorDisplayMode`，以及收藏/复刻的源设计引用 |
| API | Generate/Update/Price/Save/Publish/CreateOrder 的 request/response schema、一致错误格式和边界验证 |
| 版本治理 | schema registry、迁移函数、未知版本拒绝策略、fixture 与兼容性测试 |

## 5. 建议的 Design Contract V1

### 5.1 包与导出边界

建议包名遵循 workspace 规范：`@mystcrag/design-contract`。共享包只包含纯 schema、由 schema 推导的类型、常量、迁移函数和 fixture，不依赖 React、Three.js、Prisma、Fastify 或 LLM SDK。

建议对外导出分为：

- `DesignV1Schema` / `DesignV1`：完整领域设计，包含售价但不包含任何成本字段。
- `PublicDesignV1Schema` / `PublicDesignV1`：由 `DesignV1` 派生，进一步排除内部生产备注和模型内部元数据。
- `InternalCommercialDesignV1Schema` / `InternalCommercialDesignV1`：仅服务端使用，以 `DesignV1` 和按 `componentId` 关联的成本明细组成，包含 `unitCostMinor`、成本小计和成本规则版本。
- `OrderDesignSnapshotV1Schema`：下单时的不可变设计、定价和生产快照。
- 六组 API request/response schema 及推导类型。
- `migrateDesignToV1(input: unknown)` 和按源版本命名的显式 migration。

“唯一数据源”指设计字段、枚举、约束和 DTO 均由该包 schema 定义。成本是单独的服务端商业关注点，不属于 `DesignV1`；`InternalCommercialDesignV1` 通过 `componentId` 关联设计与成本，避免复制或泄漏整份设计数据。

### 5.2 建议顶层结构

```ts
type DesignV1 = {
  schemaVersion: "1.0.0";
  designId: string;
  designName: string;
  designMode: "AI_GENERATED" | "DIY_CREATED" | "AI_ASSISTED" | "TEMPLATE_REMIX";
  createdAt: string; // ISO 8601 UTC datetime
  updatedAt: string; // ISO 8601 UTC datetime
  locale: string; // BCP 47，如 zh-CN
  currency: "CNY" | "TWD";
  bracelet: BraceletV1;
  beads: BeadV1[];
  accessories: AccessoryV1[];
  story: StoryV1;
  pricing: PricingV1;
  production: ProductionV1;
  compliance: ComplianceV1;
  provenance: ProvenanceV1;
  community: CommunityV1;
};
```

不建议在顶层再保留 `threeConfig`。3D 必须从 `bracelet + beads + accessories` 派生场景描述，否则同一设计会存在两份可相互冲突的真相。

### 5.3 核心子结构和不变式

**BraceletV1**

- 字段：`wristCircumferenceMm`、`targetInnerCircumferenceMm`、`elasticAllowanceMm`、`braceletLayout`、`beadGapMm`、`totalBeadCount`。
- V1 只接受 `braceletLayout: "CIRCLE"`；`DOUBLE_WRAP`、`ASYMMETRIC`、`CHARM_BRACELET` 保留为未来协议扩展，不应在 V1 schema 中提前接受未定义语义。
- 所有毫米字段必须是有限、非负数；业务合理范围应作为可配置领域规则，不与基础数据类型混在一起。

**BeadV1**

- 字段：`componentId`、`positionIndex`、`beadProductId`、`crystalId`、`materialKey`、`shape`、`diameterMm`、`quantity`、`role`、`modelAssetKey`、`textureAssetKey`、`unitPriceMinor`。
- V1 每个数组元素代表一颗实际珠子，所以 `quantity` 必须是字面量 `1`；聚合数量只能在生产 BOM 派生，不能取代设计顺序。
- `componentId` 是设计内稳定 ID，用于选中、替换、撤销和 patch；`positionIndex` 表示主环组件序列的绝对位置。
- `unitPriceMinor` 必须是非负安全整数。单颗成本不属于 `BeadV1`，由 `InternalCommercialDesignV1.costItems[]` 按 `componentId` 关联。

**AccessoryV1**

- 枚举类型：`SPACER`、`PENDANT`、`METAL_PART`、`CONNECTOR`。
- 公共字段：`componentId`、`accessoryType`、`accessoryProductId`、`placementMode`、`material`、`finish`、`dimensions`、`quantity: 1`、`unitPriceMinor`、`modelAssetKey`、可选 `textureAssetKey`。
- `placementMode` 是可辨识联合：`INLINE` 必须包含 `positionIndex` 且不得包含 `anchorComponentId`；`ANCHORED` 必须包含 `anchorComponentId` 且不得包含 `positionIndex`。
- `PENDANT` 在 V1 必须使用 `ANCHORED`，通过 `anchorComponentId` 连接到珠子或主环内联配件，不占用主环 `positionIndex`。其他配件可根据实际装配方式选择 `INLINE` 或 `ANCHORED`。
- `dimensions` 应是明确的毫米对象（如 `widthMm/heightMm/depthMm/diameterMm`），不接受无结构字符串。

**顺序不变式**

- `beads` 与全部 `accessories` 的 `componentId` 必须全局唯一。珠子和 `INLINE` 配件共同组成主环序列，它们的 `positionIndex` 必须唯一。
- 主环序列的 `positionIndex` 必须是从 `0` 开始的连续整数；排序后即为 3D、DIY 和生产共同使用的主环顺序。
- `ANCHORED` 配件的 `anchorComponentId` 必须引用已存在的珠子或 `INLINE` 配件，不得引用自身或另一个 `ANCHORED` 配件，避免循环/悬空锚点。
- `bracelet.totalBeadCount === beads.length`。配件不计入珠子数。
- 完整 schema 使用 Zod `superRefine` 校验跨字段不变式。

**StoryV1**

- `emotionTags`、`styleTags`、`colorPalette`、`culturalInspiration`、`designStory`、`recommendationReasons`、`sourceTemplateIds`。
- `culturalInspiration` 项应包含 `reference`、`inspiration`、`disclaimerKey`，明确标注其为文化参考/设计灵感，非科学功效。

**PricingV1**

- 字段：`materialSubtotal`、`accessorySubtotal`、`laborFee`、`designFee`、`packagingFee`、`platformFeeEstimate`、`logisticsFeeEstimate`、`discount`、`totalPrice`、`pricingVersion`、`priceCalculatedAt`。
- 所有金额必须是非负安全整数；`discount` 是正数减免额；`totalPrice = 各正向分项之和 - discount`。
- `materialSubtotal` 必须可由珠子 `unitPriceMinor` 求和得到，`accessorySubtotal` 同理。如果业务允许人工调价，必须增加显式 adjustment 分项和原因，不能破坏可追溯等式。
- V1 支持 `CNY | TWD`。CNY 按 ISO 4217 minor unit：`1 CNY = 100` 分；TWD 的 ISO 4217 minor-unit exponent 为 0，因此 `1 TWD = 1` 新台币元。序列化与运算全程不使用浮点主币单位。
- CNY 和 TWD 必须使用各自独立的商品价格表、定价规则和 `pricingVersion`。V1 不做实时汇率换算，不得用另一币种价格乘汇率生成报价。

**InternalCommercialDesignV1**

- 仅服务端使用，建议结构为 `{ design: DesignV1, costItems, costSubtotalMinor, costRuleVersion }`，不在 `DesignV1` 的珠子或配件上增加成本字段。
- `costItems[]` 以 `componentId` 关联设计组件，包含非负安全整数 `unitCostMinor`；成本币种必须与对应内部价格表一致。
- 该 schema 不得从任何公开 package export path 或公开 DTO 导出，只能由 Backend、Pricing、Order/Production 的授权服务端路径使用。

**ProductionV1**

- 包含 `billOfMaterials`、`componentSequence`、`wristCircumferenceMm`、`productionNotes`、`substitutionRules`。
- BOM 是从最终组件序列派生的聚合视图；每个 BOM 项必须保留源 `componentId` 列表，保证展示数据与生产数据可相互追溯。
- 缺货不应偷偷替换商品。`substitutionRules` 只表达允许的候选与是否需要用户再确认。

**ComplianceV1**

- `complianceStatus`: `PENDING | PASSED | FLAGGED | REJECTED`。
- `restrictedClaims` 为结构化列表，至少包含 `code`、`category`、`fieldPath`、`severity`、`userVisibleMessage`。分类至少覆盖医疗效果、心理诊断、保证招财、保证改运、确定性命运预测。
- `disclaimerKeys` 用稳定 key 选择本地化文案，不在协议内复制多语言免责声明。
- `reviewRequired` 是业务守门字段；`FLAGGED` 或高风险 claim 必须导致人工复审，`REJECTED` 不得发布或下单。

**ProvenanceV1**

- `generatedBy`: `USER | AI | AI_AND_USER | TEMPLATE`。
- 含 `modelProvider`、`modelName`、`promptVersion`、`knowledgeBaseVersion`、`designTemplateVersion`、`pricingRuleVersion`，并允许对非 AI 设计使用明确 `null`。
- 建议额外保留 `sourceDesignId`，用于收藏后复刻和模板 remix 的追溯。不保存隐藏推理、完整系统提示词或无关用户对话。

**CommunityV1**

- `visibility`: `PRIVATE | UNLISTED | PUBLIC`，默认 `PRIVATE`。
- `publishConsent: false`、`allowRemix: false` 为安全默认值。
- `creatorDisplayMode`: 建议 `ANONYMOUS | DISPLAY_NAME`，V1 不应将真实姓名或联系信息嵌入设计协议。
- 跨字段规则：`publishConsent === false` 时 `visibility` 必须为 `PRIVATE` 且 `allowRemix` 必须为 `false`；`UNLISTED`/`PUBLIC` 必须有明确同意；合规状态未通过时不得发布。

### 5.4 API DTO 建议

所有 request 在 Backend 入口用 Zod `safeParse` 验证，所有外部 AI/provider 输出也必须在进入领域层前验证。Response 应在返回前再次按公开视图序列化，防止内部成本或模型元数据泄漏。

| DTO | 建议的核心语义 |
| --- | --- |
| `GenerateDesignRequest` | `requestId`、`locale`、`currency`、手围/目标尺寸、偏好 tags、可选预算（minor-unit 整数）、排除商品与用户同意的个人化输入 |
| `GenerateDesignResponse` | `requestId`、经验证的 `PublicDesignV1`、非致命 `warnings`；不再返回独立 `threeConfig` |
| `UpdateDesignRequest` | `designId`、`expectedUpdatedAt` 或 revision、结构化编辑操作（replace/move/add/remove/updateBracelet）；禁止任意深层 JSON patch 修改价格、合规或 provenance |
| `UpdateDesignResponse` | 更新后的 `PublicDesignV1`、新 revision/时间、库存/定价/合规 warnings |
| `PriceDesignRequest` | `designId` 或经验证的设计结构引用、`currency`、可选促销上下文；客户端传入的 unit price 不能被服务器信任 |
| `PriceDesignResponse` | 服务器从商品目录重算的 `PricingV1`、价格变化和缺货 warnings |
| `SaveDesignRequest` | 经验证的设计或 `designId + revision`；用户身份必须来自授权上下文，不信任 body 中的 owner ID |
| `SaveDesignResponse` | `designId`、revision、`savedAt`、已序列化公开设计视图 |
| `PublishDesignRequest` | `designId`、revision、`visibility`、显式 `publishConsent: true`、`allowRemix`、`creatorDisplayMode` |
| `PublishDesignResponse` | publication ID、最终发布状态/可见性、时间；不得包含内部成本或生产备注 |
| `CreateOrderFromDesignRequest` | `designId`、预期 design revision、预期 `pricingVersion`、预期 `totalPrice`、currency；地址/联系信息属订单上下文，不进入设计协议 |
| `CreateOrderFromDesignResponse` | order ID、status、服务器确认价格、`OrderDesignSnapshotV1`、createdAt；如价格/库存/版本变化则拒绝或要求再确认 |

DTO schema 还应包含一致的结构化错误，至少区分 validation、not found、conflict、compliance blocked、inventory changed 和 price changed，但通用 HTTP 错误协议应由 Backend 规范控制，不必把所有后端错误都塞入设计领域模型。

### 5.5 版本与迁移策略

- V1 完整标识为 `1.0.0`。持久化快照必须包含 `schemaVersion`，读取时先识别版本，再迁移，最后用当前 schema 验证。
- 补充向后兼容的可选字段可发布 minor 版本；改变字段语义、删除字段或改变不变式必须发布 major 版本并提供迁移。
- 未知 major 版本必须显式拒绝，不得尝试宽松解析。迁移函数不得就地修改输入。
- 当前没有生产数据，因此 V1 只实现 `legacy-initial -> 1.0.0` migration fixture 和对应测试，不执行真实 backfill。fixture 必须演示商品目录/人工补全 SKU、顺序、价格和资产键；由于聚合 `count` 无法推回原顺序，迁移不得伪称无损，应产生 warning 并要求审核。

## 6. 建议的完整示例（缩略）

以下是用于讨论字段语义的审查示例，不是已实现 schema：

```json
{
  "schemaVersion": "1.0.0",
  "designId": "des_01JZ8MYSTCRAG",
  "designName": "Rain After Blue",
  "designMode": "AI_ASSISTED",
  "createdAt": "2026-07-21T06:00:00.000Z",
  "updatedAt": "2026-07-21T06:05:00.000Z",
  "locale": "zh-CN",
  "currency": "CNY",
  "bracelet": {
    "wristCircumferenceMm": 155,
    "targetInnerCircumferenceMm": 162,
    "elasticAllowanceMm": 7,
    "braceletLayout": "CIRCLE",
    "beadGapMm": 0.4,
    "totalBeadCount": 2
  },
  "beads": [
    {
      "componentId": "cmp_bead_001",
      "positionIndex": 0,
      "beadProductId": "prod_aquamarine_8_round",
      "crystalId": "crystal_aquamarine",
      "materialKey": "aquamarine-clear-v1",
      "shape": "ROUND",
      "diameterMm": 8,
      "quantity": 1,
      "role": "MAIN",
      "modelAssetKey": "sphere-round-8mm-v1",
      "textureAssetKey": "aquamarine-clear-texture-v1",
      "unitPriceMinor": 1200
    },
    {
      "componentId": "cmp_bead_002",
      "positionIndex": 2,
      "beadProductId": "prod_moonstone_6_round",
      "crystalId": "crystal_moonstone",
      "materialKey": "moonstone-soft-v1",
      "shape": "ROUND",
      "diameterMm": 6,
      "quantity": 1,
      "role": "ACCENT",
      "modelAssetKey": "sphere-round-6mm-v1",
      "textureAssetKey": "moonstone-soft-texture-v1",
      "unitPriceMinor": 800
    }
  ],
  "accessories": [
    {
      "componentId": "cmp_acc_001",
      "accessoryType": "SPACER",
      "accessoryProductId": "prod_spacer_silver_3",
      "placementMode": "INLINE",
      "positionIndex": 1,
      "material": "STERLING_SILVER",
      "finish": "POLISHED",
      "dimensions": { "diameterMm": 3, "widthMm": 2 },
      "quantity": 1,
      "unitPriceMinor": 300,
      "modelAssetKey": "spacer-silver-3mm-v1"
    },
    {
      "componentId": "cmp_acc_002",
      "accessoryType": "PENDANT",
      "accessoryProductId": "prod_pendant_drop_silver_8",
      "placementMode": "ANCHORED",
      "anchorComponentId": "cmp_acc_001",
      "material": "STERLING_SILVER",
      "finish": "POLISHED",
      "dimensions": { "widthMm": 5, "heightMm": 8, "depthMm": 2 },
      "quantity": 1,
      "unitPriceMinor": 500,
      "modelAssetKey": "pendant-drop-silver-8mm-v1"
    }
  ],
  "story": {
    "emotionTags": ["calm"],
    "styleTags": ["minimal", "eastern-contemporary"],
    "colorPalette": ["#A8D8E8", "#F6F3EC"],
    "culturalInspiration": [
      {
        "reference": "rain-cleared-sky imagery",
        "inspiration": "Use translucent blue and soft white contrast as a visual reference.",
        "disclaimerKey": "CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT"
      }
    ],
    "designStory": "A cool, translucent rhythm inspired by the sky after rain.",
    "recommendationReasons": ["Matches the selected cool palette and minimal style."],
    "sourceTemplateIds": ["tpl_rain_after_blue_v3"]
  },
  "pricing": {
    "materialSubtotal": 2000,
    "accessorySubtotal": 800,
    "laborFee": 500,
    "designFee": 300,
    "packagingFee": 200,
    "platformFeeEstimate": 100,
    "logisticsFeeEstimate": 600,
    "discount": 0,
    "totalPrice": 4500,
    "pricingVersion": "cny-retail-2026-07-v1",
    "priceCalculatedAt": "2026-07-21T06:05:00.000Z"
  },
  "production": {
    "wristCircumferenceMm": 155,
    "billOfMaterials": [
      {
        "productId": "prod_aquamarine_8_round",
        "specification": "ROUND 8mm",
        "quantity": 1,
        "sourceComponentIds": ["cmp_bead_001"]
      }
    ],
    "componentSequence": ["cmp_bead_001", "cmp_acc_001", "cmp_bead_002"],
    "anchoredComponents": [
      { "componentId": "cmp_acc_002", "anchorComponentId": "cmp_acc_001" }
    ],
    "productionNotes": [],
    "substitutionRules": []
  },
  "compliance": {
    "complianceStatus": "PASSED",
    "restrictedClaims": [],
    "disclaimerKeys": ["CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT"],
    "reviewRequired": false
  },
  "provenance": {
    "generatedBy": "AI_AND_USER",
    "modelProvider": "provider-key",
    "modelName": "model-key",
    "promptVersion": "design-prompt-v1",
    "knowledgeBaseVersion": "crystal-kb-2026-07",
    "designTemplateVersion": "tpl-rain-v3",
    "pricingRuleVersion": "cny-retail-2026-07-v1",
    "sourceDesignId": null
  },
  "community": {
    "visibility": "PRIVATE",
    "publishConsent": false,
    "allowRemix": false,
    "creatorDisplayMode": "ANONYMOUS"
  }
}
```

`InternalCommercialDesignV1` 不内联在上述 `DesignV1` JSON 中。服务端可以用以下关联结构表达成本：

```json
{
  "design": { "designId": "des_01JZ8MYSTCRAG", "schemaVersion": "1.0.0" },
  "costItems": [
    { "componentId": "cmp_bead_001", "unitCostMinor": 450 },
    { "componentId": "cmp_acc_002", "unitCostMinor": 180 }
  ],
  "costSubtotalMinor": 630,
  "costRuleVersion": "cny-cost-2026-07-v1"
}
```

上例为缩略表示；实际 `InternalCommercialDesignV1.design` 必须是完整且已验证的 `DesignV1`。

## 7. 受影响模块与转换边界

| 模块 | 未来改动 | 转换边界 |
| --- | --- | --- |
| `packages/design-contract` | 新建 schema、types、DTO、constants、migrations、fixtures 和 tests | 设计领域和 wire contract 的唯一定义源 |
| `packages/ai-agent` | 保留通用 `Agent` contract；逐步将 `BraceletDesignOutput`/`BeadDesign` 替换为共享设计类型，Pricing/Compliance 使用共享子 schema | provider 原始 `unknown` → 严格验证的 AI candidate → Backend 补全 ID/目录价格/库存 → `DesignV1` |
| `packages/three-engine` | 删除未来的重复设计定义，改为导入共享设计子类型；保留 geometry/material/scene descriptor 运行时类型 | `DesignV1` → `toBraceletSceneDescriptor()` → Three.js/R3F runtime；运行时 GPU 参数不回写领域协议 |
| `apps/backend` | 引入 DTO schema，建立验证、授权、定价、合规、存储和发布守门 | HTTP JSON ↔ DTO；DTO ↔ domain service；domain ↔ persistence adapter |
| `packages/database` | 在单独评审的 migration 中增加 schema version、currency、minor-unit 金额、设计 revision、发布字段和订单快照 | Prisma row/Json/BigInt ↔ `DesignV1`；每次读写都验证，Prisma 类型不越过 repository |
| `apps/frontend` | 使用 `PublicDesignV1` 和 API DTO，DIY 操作基于 `componentId`/`positionIndex` | API response → validated public design → UI/editor state；不接触成本和内部生产字段 |
| Pricing / Order / Community | 使用共享子 schema 和不变式 | 目录重算价格；下单生成不可变快照；发布生成去敏公开视图 |

建议数据流：

```text
用户偏好 / DIY 操作
          |
          v
Backend DTO 运行时验证
          |
          +--> AI candidate --验证/目录补全--> DesignV1
          |                                      |
          |                                      +--> 3D adapter --> scene runtime
          |                                      +--> pricing --> PricingV1
          |                                      +--> persistence adapter --> versioned JSON/revisions
          |                                      +--> public projection --> frontend/community
          |                                      +--> order service --> immutable order snapshot + BOM
          v
  合规与权限守门
```

## 8. 迁移计划

### Phase 2A：新包，无消费者切换

1. 新建 `packages/design-contract`，使用 Zod，完成 V1 schema、推导类型、DTO、常量和 README。
2. 实现跨字段不变式，包括金额整数、总价、珠子顺序、组件唯一性、社区授权和合规守门。
3. 建立要求的 10 组 fixture：AI 标准设计、纯 DIY、AI 后修改、混合尺寸、含内联隔珠/锚定吊坠、超预算、缺货、违规文案、未授权公开、旧版迁移。无效 fixture 必须明确预期被拒绝还是被标记；legacy 仅作 fixture，不对真实数据执行 backfill。
4. 添加 schema 正/反测试和 migration 测试，先不修改现有模块。

### Phase 2B：双轨适配

1. AI Agent 新增到/从 V1 的 adapter，保留旧 export 并标记 deprecated，避免一次性删除已有接口。
2. Three Engine 新增 `DesignV1 -> BraceletSceneDescriptor` adapter，用 fixture 验证珠子和配件顺序。
3. Backend 先引入 Generate/Price DTO，再引入 Update/Save/Publish/CreateOrder；路由实现不在共享包中。
4. Frontend 仅使用去敏公开设计视图。

### Phase 2C：持久化与快照

1. 先更新 `docs/DATABASE_SCHEMA.md` 并评审 baseline migration 策略。评估 PostgreSQL `BIGINT` 作为 minor-unit 金额的存储类型；JSON 序列化时由 adapter 安全转换为 JS safe integer，或将整数上限明确限制在安全范围。
2. 将可更新的当前设计与不可变 revision/history 拆分，或至少增加单调 revision 及不可变快照表。
3. 为 Order 持久化 design/pricing/production snapshot 和各自版本；订单不仅依赖可变的当前设计。
4. 为未来有版本持久化 JSON 的读取路径保留迁移与严格验证；当前无生产数据，不执行 legacy backfill 任务。

### Phase 2D：收口

1. 在所有消费者切换且兼容测试通过后，再删除 deprecated 的 AI/3D 重复类型。
2. 更新 `API_SPECIFICATION.md`、`AI_AGENT_SPEC.md`、`THREE_ENGINE_SPEC.md`、`DATABASE_SCHEMA.md`、`TECH_ARCHITECTURE.md`，并新增 `docs/DESIGN_CONTRACT_V1.md`。
3. 添加架构测试，防止 AI、3D、Backend 和 Frontend 重新声明设计 contract。

## 9. 测试与验收计划

Phase 2 至少覆盖：

- 有效完整设计及六组 DTO 的 runtime schema 验证。
- 缺失必填字段、未知 major 版本、非法枚举、非 ISO datetime 和无效 locale/currency 的拒绝。
- 小数、NaN、Infinity、负数和超过 safe integer 的金额拒绝，以及定价加总不一致的拒绝。
- 主环重复/缺口 `positionIndex`、重复 `componentId`、`quantity !== 1`、`totalBeadCount` 不一致的拒绝。
- `INLINE` 缺少 `positionIndex`、`ANCHORED` 缺少/悬空 `anchorComponentId`、吊坠使用 `INLINE` 或锚定配件占用主环位置的拒绝。
- `publishConsent: false` 却设为 `PUBLIC/UNLISTED` 或允许 remix 的拒绝。
- 医疗效果、心理诊断、保证招财/改运和确定性命运预测的标记，以及 `REJECTED` 设计无法发布/下单。
- legacy migration fixture 的决定性、幂等性、不修改输入与信息损失 warning；不执行真实 backfill。
- `DesignV1` 和 Public projection 都拒绝 `unitCostMinor`；只有服务端 `InternalCommercialDesignV1` 接受成本，且任何公开 DTO 都不包含成本、内部生产备注、隐藏推理或用户私密对话。
- CNY 和 TWD 分别选取各自价格表/定价版本，且不存在实时汇率换算路径。
- 3D 、定价、BOM 对同一 fixture 的组件顺序和商品引用一致。

## 10. 已批准的 Design Contract V1 决策

1. Wire JSON 统一使用 camelCase，后续废弃 API 文档中的 snake_case 占位示例。
2. `schemaVersion` 使用完整 SemVer 字符串；V1 初始版本为 `1.0.0`。
3. Accessory 支持 `INLINE | ANCHORED` 两种 `placementMode`。`INLINE` 使用主环 `positionIndex`；`ANCHORED` 使用 `anchorComponentId` 且不占主环位置；吊坠必须为 `ANCHORED`。
4. `DesignV1` 不包含成本；成本仅由服务端 `InternalCommercialDesignV1` 表达，并通过 `componentId` 与设计组件关联。
5. V1 支持 CNY 和 TWD；两者使用独立价格表和定价版本，不做实时汇率转换。
6. 当前无生产数据；只实现 legacy migration fixture 及测试，不执行真实 backfill。

六项决策已经纳入本报告的协议结构、示例、迁移和测试计划。本文档批准不代表已实现 Phase 2 共享 package。
