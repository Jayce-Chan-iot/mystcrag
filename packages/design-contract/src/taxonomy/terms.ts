import { TaxonomyTermSchema, type TaxonomyTerm, type TaxonomyTermInput } from "../schemas/taxonomy.schema";

export const TAXONOMY_VERSION = "taxonomy-2026-08-v3";

const RAW_TERMS: readonly TaxonomyTermInput[] = [
  // COLOR
  { id: "color:white", domain: "COLOR", displayName: { zh: "白", en: "White" }, aliases: ["white", "白", "白色"] },
  { id: "color:purple", domain: "COLOR", displayName: { zh: "紫", en: "Purple" }, aliases: ["purple", "violet", "紫", "紫色", "淡紫", "lavender", "lilac"] },
  { id: "color:pink", domain: "COLOR", displayName: { zh: "粉", en: "Pink" }, aliases: ["pink", "rose", "粉", "粉色", "粉红"] },
  { id: "color:red", domain: "COLOR", displayName: { zh: "红", en: "Red" }, aliases: ["red", "wine", "酒红", "crimson", "红", "红色"] },
  { id: "color:orange", domain: "COLOR", displayName: { zh: "橙", en: "Orange" }, aliases: ["orange", "peach", "橙", "橙色"] },
  { id: "color:yellow", domain: "COLOR", displayName: { zh: "黄", en: "Yellow" }, aliases: ["yellow", "gold", "golden", "金", "金色", "黄", "黄色"] },
  { id: "color:green", domain: "COLOR", displayName: { zh: "绿", en: "Green" }, aliases: ["green", "olive", "绿", "绿色"] },
  { id: "color:teal", domain: "COLOR", displayName: { zh: "蓝绿", en: "Teal" }, aliases: ["teal", "cyan", "turquoise", "蓝绿"] },
  { id: "color:blue", domain: "COLOR", displayName: { zh: "蓝", en: "Blue" }, aliases: ["blue", "navy", "蓝", "蓝色"] },
  { id: "color:gray", domain: "COLOR", displayName: { zh: "灰", en: "Gray" }, aliases: ["gray", "grey", "smoky", "烟色", "灰", "灰色"] },
  { id: "color:black", domain: "COLOR", displayName: { zh: "黑", en: "Black" }, aliases: ["black", "ink", "墨色", "黑", "黑色"] },
  { id: "color:brown", domain: "COLOR", displayName: { zh: "棕", en: "Brown" }, aliases: ["brown", "褐", "棕", "棕色", "褐色"] },
  { id: "color:multicolor", domain: "COLOR", displayName: { zh: "多色", en: "Multicolor" }, aliases: ["multicolor", "rainbow", "彩虹", "多色", "mixed-color"] },

  // TEMPERATURE
  { id: "temperature:warm", domain: "TEMPERATURE", displayName: { zh: "暖色", en: "Warm" }, aliases: ["warm", "暖", "暖色"] },
  { id: "temperature:neutral", domain: "TEMPERATURE", displayName: { zh: "中性", en: "Neutral" }, aliases: ["neutral", "中性"] },
  { id: "temperature:cool", domain: "TEMPERATURE", displayName: { zh: "冷色", en: "Cool" }, aliases: ["cool", "冷", "冷色", "清冷", "清爽", "fresh"] },

  // TRANSPARENCY
  { id: "transparency:transparent", domain: "TRANSPARENCY", displayName: { zh: "透明", en: "Transparent" }, aliases: ["transparent", "clear", "清透", "透明"] },
  { id: "transparency:translucent", domain: "TRANSPARENCY", displayName: { zh: "半透明", en: "Translucent" }, aliases: ["translucent", "半透明"] },
  { id: "transparency:opaque", domain: "TRANSPARENCY", displayName: { zh: "不透明", en: "Opaque" }, aliases: ["opaque", "不透明"] },

  // LUSTER
  { id: "luster:matte", domain: "LUSTER", displayName: { zh: "哑光", en: "Matte" }, aliases: ["matte", "哑光"] },
  { id: "luster:soft", domain: "LUSTER", displayName: { zh: "柔光", en: "Soft" }, aliases: ["soft", "柔和", "柔光"] },
  { id: "luster:bright", domain: "LUSTER", displayName: { zh: "亮光", en: "Bright" }, aliases: ["bright", "glossy", "shiny", "亮泽", "亮光"] },

  // TEXTURE
  { id: "texture:smooth", domain: "TEXTURE", displayName: { zh: "光滑", en: "Smooth" }, aliases: ["smooth", "光滑"] },
  { id: "texture:banded", domain: "TEXTURE", displayName: { zh: "条带", en: "Banded" }, aliases: ["banded", "layered", "条纹", "条带", "striped"] },
  { id: "texture:included", domain: "TEXTURE", displayName: { zh: "包裹体", en: "Inclusions" }, aliases: ["included", "inclusions", "包体", "包裹体"] },
  { id: "texture:phantom", domain: "TEXTURE", displayName: { zh: "幽灵包裹", en: "Phantom" }, aliases: ["phantom", "幽灵"] },
  { id: "texture:crackled", domain: "TEXTURE", displayName: { zh: "爆裂纹", en: "Crackled" }, aliases: ["crackled", "cracked", "爆花", "爆裂纹"] },
  { id: "texture:iridescent-sheen", domain: "TEXTURE", displayName: { zh: "晕彩", en: "Iridescent sheen" }, aliases: ["iridescent-sheen", "flash", "iridescence", "iridescent", "labradorescence", "rainbow-flash", "晕彩"] },
  { id: "texture:catseye", domain: "TEXTURE", displayName: { zh: "猫眼效应", en: "Cat's eye" }, aliases: ["catseye", "cats-eye", "chatoyant", "猫眼"] },
  { id: "texture:speckled", domain: "TEXTURE", displayName: { zh: "斑点", en: "Speckled" }, aliases: ["speckled", "spotted", "斑点"] },
  { id: "texture:veined", domain: "TEXTURE", displayName: { zh: "脉纹", en: "Veined" }, aliases: ["veined", "纹路", "脉纹"] },

  // STYLE
  { id: "style:minimal", domain: "STYLE", displayName: { zh: "极简", en: "Minimal" }, aliases: ["minimal", "minimalist", "克制极简", "简约", "极简"] },
  { id: "style:eastern-contemporary", domain: "STYLE", displayName: { zh: "东方当代", en: "Eastern contemporary" }, aliases: ["eastern-contemporary", "contemporary-eastern", "eastern", "东方", "东方当代", "新中式"] },
  { id: "style:romantic", domain: "STYLE", displayName: { zh: "浪漫", en: "Romantic" }, aliases: ["romantic", "浪漫"] },
  { id: "style:natural", domain: "STYLE", displayName: { zh: "自然", en: "Natural" }, aliases: ["natural", "organic", "naturalistic", "自然", "自然不规则"] },
  { id: "style:modern", domain: "STYLE", displayName: { zh: "现代", en: "Modern" }, aliases: ["modern", "contemporary", "现代"] },
  { id: "style:vintage", domain: "STYLE", displayName: { zh: "复古", en: "Vintage" }, aliases: ["vintage", "retro", "古典", "复古", "classical"] },
  { id: "style:ethereal", domain: "STYLE", displayName: { zh: "空灵", en: "Ethereal" }, aliases: ["ethereal", "airy", "dreamy", "light", "轻盈", "飘逸", "空灵"] },
  { id: "style:delicate", domain: "STYLE", displayName: { zh: "精致轻珠宝", en: "Delicate fine jewelry" }, aliases: ["delicate", "fine-jewelry", "精致", "精致轻珠宝"] },

  // EMOTION
  { id: "emotion:calm", domain: "EMOTION", displayName: { zh: "平静", en: "Calm" }, aliases: ["calm", "calm-aesthetic", "relaxed", "soothing", "安静", "安宁", "平静"] },
  { id: "emotion:focus", domain: "EMOTION", displayName: { zh: "专注", en: "Focus" }, aliases: ["focus", "concentration", "专注", "专注力"] },
  { id: "emotion:confidence", domain: "EMOTION", displayName: { zh: "自信", en: "Confidence" }, aliases: ["confidence", "confident", "自信"] },
  { id: "emotion:joy", domain: "EMOTION", displayName: { zh: "喜悦", en: "Joy" }, aliases: ["joy", "happy", "joyful", "开心", "快乐", "喜悦"] },
  { id: "emotion:connection", domain: "EMOTION", displayName: { zh: "连结", en: "Connection" }, aliases: ["connection", "bond", "联结", "连结"] },
  { id: "emotion:renewal", domain: "EMOTION", displayName: { zh: "焕新", en: "Renewal" }, aliases: ["renewal", "新生", "焕新"] },
  { id: "emotion:hope", domain: "EMOTION", displayName: { zh: "希望", en: "Hope" }, aliases: ["hope", "hopeful", "希望"] },
  { id: "emotion:love", domain: "EMOTION", displayName: { zh: "爱", en: "Love" }, aliases: ["love", "爱", "爱意"] },
  { id: "emotion:courage", domain: "EMOTION", displayName: { zh: "勇气", en: "Courage" }, aliases: ["courage", "bold", "brave", "勇气"] },
  { id: "emotion:grounding", domain: "EMOTION", displayName: { zh: "沉稳安定", en: "Grounding" }, aliases: ["grounding", "grounded", "stability", "stable", "安定", "沉稳", "稳定"] },
  { id: "emotion:vitality", domain: "EMOTION", displayName: { zh: "活力", en: "Vitality" }, aliases: ["vitality", "energy", "energetic", "元气", "活力"] },
  { id: "emotion:protection", domain: "EMOTION", displayName: { zh: "守护（文化意象）", en: "Protection (cultural)" }, aliases: ["protection", "护佑", "守护"] },

  // MATERIAL
  { id: "material:quartz", domain: "MATERIAL", displayName: { zh: "石英", en: "Quartz" }, aliases: ["quartz", "水晶", "石英"] },
  { id: "material:feldspar", domain: "MATERIAL", displayName: { zh: "长石", en: "Feldspar" }, aliases: ["feldspar", "长石"] },
  { id: "material:beryl", domain: "MATERIAL", displayName: { zh: "绿柱石", en: "Beryl" }, aliases: ["beryl", "绿柱石"] },
  { id: "material:chalcedony", domain: "MATERIAL", displayName: { zh: "玉髓", en: "Chalcedony" }, aliases: ["chalcedony", "玉髓"] },
  { id: "material:agate", domain: "MATERIAL", displayName: { zh: "玛瑙", en: "Agate" }, aliases: ["agate", "玛瑙"], parentId: "material:chalcedony" },
  { id: "material:garnet", domain: "MATERIAL", displayName: { zh: "石榴石族", en: "Garnet group" }, aliases: ["garnet", "石榴石"] },
  { id: "material:fluorite", domain: "MATERIAL", displayName: { zh: "萤石", en: "Fluorite" }, aliases: ["fluorite", "氟石", "萤石"] },
  { id: "material:obsidian", domain: "MATERIAL", displayName: { zh: "黑曜石", en: "Obsidian" }, aliases: ["obsidian", "黑曜石"] },
  { id: "material:lapis-lazuli", domain: "MATERIAL", displayName: { zh: "青金石", en: "Lapis lazuli" }, aliases: ["lapis-lazuli", "lapis", "lazurite", "青金石"] },
  { id: "material:rhodonite", domain: "MATERIAL", displayName: { zh: "蔷薇辉石", en: "Rhodonite" }, aliases: ["rhodonite", "蔷薇辉石"] },
  { id: "material:tourmaline", domain: "MATERIAL", displayName: { zh: "碧玺", en: "Tourmaline" }, aliases: ["tourmaline", "电气石", "碧玺"] },
  { id: "material:jade", domain: "MATERIAL", displayName: { zh: "玉石", en: "Jade" }, aliases: ["jade", "玉", "玉石"] },
  { id: "material:jadeite", domain: "MATERIAL", displayName: { zh: "翡翠", en: "Jadeite" }, aliases: ["jadeite", "硬玉", "翡翠"], parentId: "material:jade" },
  { id: "material:nephrite", domain: "MATERIAL", displayName: { zh: "和田玉", en: "Nephrite" }, aliases: ["nephrite", "软玉", "和田玉"], parentId: "material:jade" },
  { id: "material:pyrite", domain: "MATERIAL", displayName: { zh: "黄铁矿", en: "Pyrite" }, aliases: ["pyrite", "黄铁矿"] },
  { id: "material:hematite", domain: "MATERIAL", displayName: { zh: "赤铁矿", en: "Hematite" }, aliases: ["hematite", "赤铁矿"] },
  { id: "material:calcite", domain: "MATERIAL", displayName: { zh: "方解石", en: "Calcite" }, aliases: ["calcite", "方解石"] },
  { id: "material:topaz", domain: "MATERIAL", displayName: { zh: "托帕石", en: "Topaz" }, aliases: ["topaz", "黄玉", "托帕石"] },
  { id: "material:sterling-silver", domain: "MATERIAL", displayName: { zh: "纯银", en: "Sterling silver" }, aliases: ["sterling-silver", "925-silver", "silver", "银", "纯银"] },
  { id: "material:gold", domain: "MATERIAL", displayName: { zh: "黄金", en: "Gold" }, aliases: ["yellow-gold", "黄金"] },

  // MATERIAL — specific crystals (acquisition round 1, task book §13)
  // Quartz family
  { id: "material:amethyst", domain: "MATERIAL", displayName: { zh: "紫水晶", en: "Amethyst" }, aliases: ["amethyst", "紫水晶", "紫晶"], parentId: "material:quartz" },
  { id: "material:citrine", domain: "MATERIAL", displayName: { zh: "黄水晶", en: "Citrine" }, aliases: ["citrine", "黄水晶", "黄晶"], parentId: "material:quartz" },
  { id: "material:rose-quartz", domain: "MATERIAL", displayName: { zh: "粉水晶", en: "Rose quartz" }, aliases: ["rose-quartz", "粉晶", "粉水晶", "玫瑰水晶", "芙蓉石"], parentId: "material:quartz" },
  { id: "material:smoky-quartz", domain: "MATERIAL", displayName: { zh: "茶水晶", en: "Smoky quartz" }, aliases: ["smoky-quartz", "茶晶", "茶水晶", "烟晶", "烟水晶"], parentId: "material:quartz" },
  { id: "material:clear-quartz", domain: "MATERIAL", displayName: { zh: "白水晶", en: "Clear quartz" }, aliases: ["clear-quartz", "rock-crystal", "白水晶", "无色水晶"], parentId: "material:quartz" },
  { id: "material:rutilated-quartz", domain: "MATERIAL", displayName: { zh: "发晶", en: "Rutilated quartz" }, aliases: ["rutilated-quartz", "rutilated", "发晶", "金发晶", "钛晶"], parentId: "material:quartz" },
  { id: "material:phantom-quartz", domain: "MATERIAL", displayName: { zh: "幽灵水晶", en: "Phantom quartz" }, aliases: ["phantom-quartz", "幽灵水晶", "绿幽灵", "异象水晶"], parentId: "material:quartz" },
  { id: "material:strawberry-quartz", domain: "MATERIAL", displayName: { zh: "草莓水晶", en: "Strawberry quartz" }, aliases: ["strawberry-quartz", "草莓水晶", "草莓晶"], parentId: "material:quartz" },
  { id: "material:ametrine", domain: "MATERIAL", displayName: { zh: "紫黄晶", en: "Ametrine" }, aliases: ["ametrine", "紫黄晶"], parentId: "material:quartz" },
  { id: "material:prasiolite", domain: "MATERIAL", displayName: { zh: "绿水晶", en: "Prasiolite" }, aliases: ["prasiolite", "green-quartz", "绿水晶"], parentId: "material:quartz" },
  // Chalcedony family
  { id: "material:carnelian", domain: "MATERIAL", displayName: { zh: "红玉髓", en: "Carnelian" }, aliases: ["carnelian", "红玉髓", "红玛瑙"], parentId: "material:chalcedony" },
  { id: "material:chrysoprase", domain: "MATERIAL", displayName: { zh: "绿玉髓", en: "Chrysoprase" }, aliases: ["chrysoprase", "绿玉髓", "澳洲玉"], parentId: "material:chalcedony" },
  { id: "material:onyx", domain: "MATERIAL", displayName: { zh: "缟玛瑙", en: "Onyx" }, aliases: ["onyx", "黑玛瑙", "缟玛瑙"], parentId: "material:chalcedony" },
  { id: "material:sardonyx", domain: "MATERIAL", displayName: { zh: "红缟玛瑙", en: "Sardonyx" }, aliases: ["sardonyx", "红缟玛瑙"], parentId: "material:chalcedony" },
  { id: "material:bloodstone", domain: "MATERIAL", displayName: { zh: "血玉髓", en: "Bloodstone" }, aliases: ["bloodstone", "heliotrope", "血玉髓"], parentId: "material:chalcedony" },
  { id: "material:jasper", domain: "MATERIAL", displayName: { zh: "碧玉", en: "Jasper" }, aliases: ["jasper", "碧石", "碧玉"], parentId: "material:chalcedony" },
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
  { id: "material:turquoise", domain: "MATERIAL", displayName: { zh: "绿松石", en: "Turquoise" }, aliases: ["绿松石", "松石"] },
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
  { id: "material:tiger-eye", domain: "MATERIAL", displayName: { zh: "虎眼石", en: "Tiger's eye" }, aliases: ["tiger-eye", "tigers-eye", "虎眼石", "虎睛石"] },
  { id: "material:hawk-eye", domain: "MATERIAL", displayName: { zh: "鹰眼石", en: "Hawk's eye" }, aliases: ["hawk-eye", "hawks-eye", "鹰眼石"] },
  { id: "material:pietersite", domain: "MATERIAL", displayName: { zh: "彼得石", en: "Pietersite" }, aliases: ["pietersite", "彼得石"] },
  { id: "material:selenite", domain: "MATERIAL", displayName: { zh: "透石膏", en: "Selenite" }, aliases: ["selenite", "satin-spar", "透石膏"] },

  // COMPOSITION_ROLE
  { id: "composition-role:main", domain: "COMPOSITION_ROLE", displayName: { zh: "主珠", en: "Main" }, aliases: ["main", "primary", "主材", "主珠"] },
  { id: "composition-role:accent", domain: "COMPOSITION_ROLE", displayName: { zh: "辅珠", en: "Accent" }, aliases: ["accent", "secondary", "辅材", "辅珠", "配珠"] },
  { id: "composition-role:focal", domain: "COMPOSITION_ROLE", displayName: { zh: "焦点珠", en: "Focal" }, aliases: ["focal", "hero", "焦点", "焦点珠"] },
  { id: "composition-role:spacer", domain: "COMPOSITION_ROLE", displayName: { zh: "隔珠", en: "Spacer" }, aliases: ["spacer", "隔片", "隔珠"] },
  { id: "composition-role:pendant", domain: "COMPOSITION_ROLE", displayName: { zh: "吊坠", en: "Pendant" }, aliases: ["pendant", "坠子", "吊坠"] },

  // KNOWLEDGE_DOMAIN
  { id: "knowledge-domain:color-theory", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "色彩理论", en: "Color theory" }, aliases: ["色彩理论"] },
  { id: "knowledge-domain:material-compatibility", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "材质相容", en: "Material compatibility" }, aliases: ["材质相容"] },
  { id: "knowledge-domain:style-rule", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "风格规则", en: "Style rule" }, aliases: ["风格规则"] },
  { id: "knowledge-domain:proportion-rule", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "比例规则", en: "Proportion rule" }, aliases: ["比例规则"] },
  { id: "knowledge-domain:composition-rule", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "构图规则", en: "Composition rule" }, aliases: ["构图规则"] },
  { id: "knowledge-domain:transition-rule", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "过渡规则", en: "Transition rule" }, aliases: ["过渡规则"] },
  { id: "knowledge-domain:focal-rule", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "焦点规则", en: "Focal rule" }, aliases: ["焦点规则"] },
  { id: "knowledge-domain:negative-rule", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "负面清单", en: "Negative rule" }, aliases: ["负面清单"] },
  { id: "knowledge-domain:cultural-symbolism", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "文化象征", en: "Cultural symbolism" }, aliases: ["文化象征"] },
  { id: "knowledge-domain:tarot", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "塔罗知识", en: "Tarot" }, aliases: ["塔罗知识", "塔罗意象"] },
  { id: "knowledge-domain:market-observation", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "市场观察", en: "Market observation" }, aliases: ["市场观察"] },
  { id: "knowledge-domain:crystal-gemology", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "水晶宝石学", en: "Crystal gemology" }, aliases: ["crystal-gemology"] },
  { id: "knowledge-domain:crystal-visual-properties", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "水晶视觉属性", en: "Crystal visual properties" }, aliases: ["crystal-visual-properties"] },
  { id: "knowledge-domain:crystal-cultural-symbolism", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "水晶文化寓意", en: "Crystal cultural symbolism" }, aliases: ["crystal-cultural-symbolism"] },
  { id: "knowledge-domain:wuxing", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "五行", en: "Wuxing" }, aliases: ["wuxing", "five-phases"] },
  { id: "knowledge-domain:wuxing-crystal-association", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "五行水晶关联", en: "Wuxing crystal association" }, aliases: ["wuxing-crystal-association"] },
  { id: "knowledge-domain:zodiac", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "星座", en: "Zodiac" }, aliases: ["zodiac"] },
  { id: "knowledge-domain:zodiac-crystal-association", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "星座水晶关联", en: "Zodiac crystal association" }, aliases: ["zodiac-crystal-association"] },
  { id: "knowledge-domain:tarot-symbolism", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "塔罗象征", en: "Tarot symbolism" }, aliases: ["tarot-symbolism"] },
  { id: "knowledge-domain:tarot-crystal-association", domain: "KNOWLEDGE_DOMAIN", displayName: { zh: "塔罗水晶关联", en: "Tarot crystal association" }, aliases: ["tarot-crystal-association"] },

  // CONTEXT_SOURCE
  { id: "context-source:questionnaire", domain: "CONTEXT_SOURCE", displayName: { zh: "问卷", en: "Questionnaire" }, aliases: ["questionnaire", "问卷"] },
  { id: "context-source:manual", domain: "CONTEXT_SOURCE", displayName: { zh: "手动", en: "Manual" }, aliases: ["manual", "手动"] },
  { id: "context-source:tarot", domain: "CONTEXT_SOURCE", displayName: { zh: "塔罗", en: "Tarot" }, aliases: ["tarot", "塔罗", "塔罗牌"] },
  { id: "context-source:astrology", domain: "CONTEXT_SOURCE", displayName: { zh: "星座", en: "Astrology" }, aliases: ["astrology", "星座"] },
  { id: "context-source:five-elements", domain: "CONTEXT_SOURCE", displayName: { zh: "五行", en: "Five elements" }, aliases: ["five-elements", "五行"] },
  { id: "context-source:style-test", domain: "CONTEXT_SOURCE", displayName: { zh: "风格测试", en: "Style test" }, aliases: ["style-test", "风格测试"] },

  // SATURATION_LEVEL
  { id: "saturation-level:low", domain: "SATURATION_LEVEL", displayName: { zh: "低饱和", en: "Low saturation" }, aliases: ["muted", "低饱和"] },
  { id: "saturation-level:medium", domain: "SATURATION_LEVEL", displayName: { zh: "中饱和", en: "Medium saturation" }, aliases: ["中饱和"] },
  { id: "saturation-level:high", domain: "SATURATION_LEVEL", displayName: { zh: "高饱和", en: "High saturation" }, aliases: ["vivid", "鲜艳", "高饱和"] },

  // LIGHTNESS_LEVEL
  { id: "lightness-level:low", domain: "LIGHTNESS_LEVEL", displayName: { zh: "低明度", en: "Low lightness" }, aliases: ["dark", "deep", "暗色", "深色", "低明度"] },
  { id: "lightness-level:medium", domain: "LIGHTNESS_LEVEL", displayName: { zh: "中明度", en: "Medium lightness" }, aliases: ["中明度"] },
  { id: "lightness-level:high", domain: "LIGHTNESS_LEVEL", displayName: { zh: "高明度", en: "High lightness" }, aliases: ["pale", "浅色", "高明度"] },

  // TAROT — the 22 major arcana (soft cultural context, task book §66; card
  // identities mirror the tarot-engine card catalog)
  { id: "tarot:major-00-the-fool", domain: "TAROT", displayName: { zh: "愚者", en: "The Fool" }, aliases: ["the fool", "愚者"] },
  { id: "tarot:major-01-the-magician", domain: "TAROT", displayName: { zh: "魔术师", en: "The Magician" }, aliases: ["the magician", "魔术师"] },
  { id: "tarot:major-02-the-high-priestess", domain: "TAROT", displayName: { zh: "女祭司", en: "The High Priestess" }, aliases: ["the high priestess", "女祭司"] },
  { id: "tarot:major-03-the-empress", domain: "TAROT", displayName: { zh: "皇后", en: "The Empress" }, aliases: ["the empress", "皇后"] },
  { id: "tarot:major-04-the-emperor", domain: "TAROT", displayName: { zh: "皇帝", en: "The Emperor" }, aliases: ["the emperor", "皇帝"] },
  { id: "tarot:major-05-the-hierophant", domain: "TAROT", displayName: { zh: "教皇", en: "The Hierophant" }, aliases: ["the hierophant", "教皇"] },
  { id: "tarot:major-06-the-lovers", domain: "TAROT", displayName: { zh: "恋人", en: "The Lovers" }, aliases: ["the lovers", "恋人"] },
  { id: "tarot:major-07-the-chariot", domain: "TAROT", displayName: { zh: "战车", en: "The Chariot" }, aliases: ["the chariot", "战车"] },
  { id: "tarot:major-08-strength", domain: "TAROT", displayName: { zh: "力量", en: "Strength" }, aliases: ["strength", "力量"] },
  { id: "tarot:major-09-the-hermit", domain: "TAROT", displayName: { zh: "隐者", en: "The Hermit" }, aliases: ["the hermit", "隐者"] },
  { id: "tarot:major-10-wheel-of-fortune", domain: "TAROT", displayName: { zh: "命运之轮", en: "Wheel of Fortune" }, aliases: ["wheel of fortune", "命运之轮"] },
  { id: "tarot:major-11-justice", domain: "TAROT", displayName: { zh: "正义", en: "Justice" }, aliases: ["justice", "正义"] },
  { id: "tarot:major-12-the-hanged-man", domain: "TAROT", displayName: { zh: "倒吊人", en: "The Hanged Man" }, aliases: ["the hanged man", "倒吊人"] },
  { id: "tarot:major-13-death", domain: "TAROT", displayName: { zh: "死神", en: "Death" }, aliases: ["death", "死神"] },
  { id: "tarot:major-14-temperance", domain: "TAROT", displayName: { zh: "节制", en: "Temperance" }, aliases: ["temperance", "节制"] },
  { id: "tarot:major-15-the-devil", domain: "TAROT", displayName: { zh: "恶魔", en: "The Devil" }, aliases: ["the devil", "恶魔"] },
  { id: "tarot:major-16-the-tower", domain: "TAROT", displayName: { zh: "高塔", en: "The Tower" }, aliases: ["the tower", "高塔"] },
  { id: "tarot:major-17-the-star", domain: "TAROT", displayName: { zh: "星星", en: "The Star" }, aliases: ["the star", "星星"] },
  { id: "tarot:major-18-the-moon", domain: "TAROT", displayName: { zh: "月亮", en: "The Moon" }, aliases: ["the moon", "月亮"] },
  { id: "tarot:major-19-the-sun", domain: "TAROT", displayName: { zh: "太阳", en: "The Sun" }, aliases: ["the sun", "太阳"] },
  { id: "tarot:major-20-judgement", domain: "TAROT", displayName: { zh: "审判", en: "Judgement" }, aliases: ["judgement", "审判"] },
  { id: "tarot:major-21-the-world", domain: "TAROT", displayName: { zh: "世界", en: "The World" }, aliases: ["the world", "世界"] },

  // WUXING — the five phases (task book §20: cultural/traditional semantics, never scientific)
  { id: "wuxing:wood", domain: "WUXING", displayName: { zh: "木", en: "Wood" }, aliases: ["wood", "木", "甲", "乙"] },
  { id: "wuxing:fire", domain: "WUXING", displayName: { zh: "火", en: "Fire" }, aliases: ["fire", "火", "丙", "丁"] },
  { id: "wuxing:earth", domain: "WUXING", displayName: { zh: "土", en: "Earth" }, aliases: ["earth", "土", "戊", "己"] },
  { id: "wuxing:metal", domain: "WUXING", displayName: { zh: "金", en: "Metal" }, aliases: ["metal", "庚", "辛"] },
  { id: "wuxing:water", domain: "WUXING", displayName: { zh: "水", en: "Water" }, aliases: ["water", "水", "壬", "癸"] },

  // ZODIAC — the twelve signs (cultural association semantics only)
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
  { id: "zodiac:pisces", domain: "ZODIAC", displayName: { zh: "双鱼座", en: "Pisces" }, aliases: ["pisces", "双鱼", "双鱼座"] }
];

// TAROT — the 56 minor arcana, generated (task book §16; card ids align with
// the tarot-engine catalog format `wands-01` via aliases)
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
    displayName: { zh: `${suit.zh}${rank.zh}`, en: `${rank.en} of ${suit.en}` },
    aliases: [
      `${suit.id}-${String(rank.n).padStart(2, "0")}`,
      `${rank.en.toLowerCase()} of ${suit.id}`,
      `${suit.zh}${rank.zh}`
    ]
  }))
);

export const TAXONOMY_TERMS: readonly TaxonomyTerm[] = [...RAW_TERMS, ...MINOR_ARCANA_TERMS].map(
  (term) => TaxonomyTermSchema.parse(term)
);
