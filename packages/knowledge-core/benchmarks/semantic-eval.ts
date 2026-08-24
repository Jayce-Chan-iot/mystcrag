/**
 * Semantic retrieval evaluation set (Knowledge Quality Phase Q1).
 *
 * A labeled bilingual corpus + query set that measures whether an embedding
 * provider ranks the right document first — the quality dimension the
 * latency benchmark cannot see. Queries split into two classes:
 *
 *   lexical    — query and target share obvious tokens (hash baseline works)
 *   paraphrase — same meaning, different words (only semantic models work)
 *
 * Runs fully in-process (no database): embed corpus + queries per provider,
 * rank by cosine, report Recall@1 / Recall@5 / MRR per class. The hash
 * baseline always runs; a semantic provider joins when
 * KNOWLEDGE_EMBEDDING_ENDPOINT (+ optional API key / model / dimensions) is
 * configured, e.g. a BGE-M3 endpoint.
 *
 *   pnpm --filter @mystcrag/knowledge-core bench:semantic
 */
import {
  FallbackEmbeddingProvider,
  HashEmbeddingProvider,
  SemanticEmbeddingProvider,
  type EmbeddingProvider
} from "../src/index.js";

type EvalDoc = { id: string; text: string };
type EvalQuery = { id: string; query: string; expected: string; kind: "lexical" | "paraphrase" };

const CORPUS: readonly EvalDoc[] = [
  { id: "color-complementary", text: "互补色 complementary colors sit opposite on the color wheel; in bead bracelets they create the strongest contrast, e.g. amethyst purple against citrine yellow." },
  { id: "color-analogous", text: "邻近色 analogous palettes use neighbors on the color wheel for a soft, harmonious gradient feel across a strand." },
  { id: "color-monochrome", text: "单色 monochrome designs vary only tone and lightness of one hue; a single accent 弟子珠 bead breaks the monotony." },
  { id: "material-water-sensitive", text: "Selenite 石膏是一种溶于水的矿物，遇水会溶解或雾化，佩戴时应避免接触水，清洁只用干布干擦。" },
  { id: "material-sun-fade", text: "Amethyst 紫水晶长期阳光直射会褪色，颜色变浅发白，收纳与佩戴都应避开强光，保持色彩浓郁。" },
  { id: "material-hardness", text: "莫氏硬度 Mohs scale：石英 7、黄玉 8、石膏仅 2。硬度低的珠子与高硬度珠串在一起容易被刮花。" },
  { id: "material-restring", text: "弹力线 elastic cord 会老化松弛，日常佩戴的手串建议每年更换一次线材，防止突然断裂散珠。" },
  { id: "proportion-focal", text: "焦点石 focal bead sizing: an 8-10mm centerpiece against 4-6mm surrounding beads reads clearly as the visual anchor of the wrist." },
  { id: "proportion-golden", text: "黄金比例 golden ratio ≈1.618 可用于主石与陪衬珠的数量分配，使整体视觉重心稳定。" },
  { id: "proportion-symmetry", text: "对称 symmetric layouts mirror bead sizes left-to-right around the focal bead, producing a formal, balanced read." },
  { id: "transition-gradient", text: "渐变过渡 gradient sequencing steps bead diameter gradually (e.g. 4-5-6-8-6-5-4mm), smoothing the visual path around the wrist." },
  { id: "transition-spacer", text: "隔珠 spacers create deliberate visual pauses; 925 silver spacers break long runs of one material." },
  { id: "tarot-sun", text: "塔罗太阳牌 The Sun upright: joy, success, vitality, clarity — a confident, warm pairing for citrine or amber tones." },
  { id: "tarot-moon", text: "塔罗月亮牌 The Moon: illusion, subconscious unease, things not being what they seem; often paired with moonstone or labradorite." },
  { id: "tarot-star", text: "塔罗星星牌 The Star: renewed hope, calm healing after turmoil, gentle faith in what comes next." },
  { id: "symbolism-clarity", text: "透明晶体 clear quartz symbolizes clarity and purity of intention; it is the neutral canvas of crystal symbolism." },
  { id: "symbolism-love", text: "粉晶 rose quartz is the stone of unconditional love, gentleness and emotional warmth in pairing symbolism." },
  { id: "market-morandi-2026", text: "2026 市场趋势 market observation: morandi 莫兰迪低饱和色调持续流行，灰粉、雾霾蓝手串在年轻消费群体中搜索量上升。" },
  { id: "market-amethyst-price", text: "紫水晶市场价格 amethyst pricing moved with Brazilian output this year; mid-grade beads remain affordable while deep Siberian-tone saturation commands a premium." },
  { id: "market-bridal", text: "新娘 bridal bead market: pearl-and-quartz wrist pieces in soft ivory and blush dominate wedding-season demand." },
  { id: "negative-malachite", text: "孔雀石 malachite 含铜，长期接触汗水与湿气可能使表面失去光泽，运动、洗澡时应取下。" },
  { id: "negative-overload", text: "负面清单：一条手串不宜同时出现多个视觉焦点，过度堆叠 focal points 会让设计显得杂乱无章。" },
  { id: "care-cleaning", text: "清洁 cleaning: use a soft cloth with lukewarm water and mild soap; avoid ultrasonic cleaners for cracked or included stones." },
  { id: "care-storage", text: "收纳 storage: keep bracelets in a cool dry place, each in its own pouch, so harder stones do not scratch softer neighbors." }
];

const QUERIES: readonly EvalQuery[] = [
  { id: "l01", query: "互补色 搭配", expected: "color-complementary", kind: "lexical" },
  { id: "l02", query: "analogous colors palette", expected: "color-analogous", kind: "lexical" },
  { id: "l03", query: "单色 monochrome 设计", expected: "color-monochrome", kind: "lexical" },
  { id: "l04", query: "selenite 溶于水", expected: "material-water-sensitive", kind: "lexical" },
  { id: "l05", query: "紫水晶 褪色", expected: "material-sun-fade", kind: "lexical" },
  { id: "l06", query: "莫氏硬度 quartz", expected: "material-hardness", kind: "lexical" },
  { id: "l07", query: "弹力线 老化 更换", expected: "material-restring", kind: "lexical" },
  { id: "l08", query: "focal bead 尺寸", expected: "proportion-focal", kind: "lexical" },
  { id: "l09", query: "黄金比例 1.618", expected: "proportion-golden", kind: "lexical" },
  { id: "l10", query: "对称 symmetric balance", expected: "proportion-symmetry", kind: "lexical" },
  { id: "l11", query: "渐变 gradient 直径", expected: "transition-gradient", kind: "lexical" },
  { id: "l12", query: "隔珠 spacer 925", expected: "transition-spacer", kind: "lexical" },
  { id: "l13", query: "太阳牌 The Sun", expected: "tarot-sun", kind: "lexical" },
  { id: "l14", query: "月亮牌 illusion", expected: "tarot-moon", kind: "lexical" },
  { id: "l15", query: "星星牌 hope healing", expected: "tarot-star", kind: "lexical" },
  { id: "l16", query: "rose quartz love", expected: "symbolism-love", kind: "lexical" },
  { id: "l17", query: "2026 趋势 莫兰迪", expected: "market-morandi-2026", kind: "lexical" },
  { id: "l18", query: "malachite 毒性 汗水", expected: "negative-malachite", kind: "lexical" },
  { id: "l19", query: "清洁 soft cloth", expected: "care-cleaning", kind: "lexical" },
  { id: "l20", query: "收纳 storage pouch", expected: "care-storage", kind: "lexical" },
  { id: "p01", query: "洗澡的时候要摘下手串吗，哪种材质最怕水", expected: "material-water-sensitive", kind: "paraphrase" },
  { id: "p02", query: "晒太阳久了颜色变淡的石头", expected: "material-sun-fade", kind: "paraphrase" },
  { id: "p03", query: "怎么存放才不会互相刮花", expected: "care-storage", kind: "paraphrase" },
  { id: "p04", query: "手腕上抢眼的东西太多显得乱", expected: "negative-overload", kind: "paraphrase" },
  { id: "p05", query: "结婚季节适合送什么手串", expected: "market-bridal", kind: "paraphrase" },
  { id: "p06", query: "黑夜过后重新相信未来的那张牌", expected: "tarot-star", kind: "paraphrase" },
  { id: "p07", query: "which stone stands for unconditional tenderness", expected: "symbolism-love", kind: "paraphrase" },
  { id: "p08", query: "muted dusty tones trending with younger buyers", expected: "market-morandi-2026", kind: "paraphrase" },
  { id: "p09", query: "how often should the cord be redone", expected: "material-restring", kind: "paraphrase" },
  { id: "p10", query: "ways to step bead size smoothly around the strand", expected: "transition-gradient", kind: "paraphrase" }
];

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  for (let index = 0; index < left.length; index++) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return dot;
}

async function embedAll(
  provider: EmbeddingProvider,
  texts: readonly string[]
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += 32) {
    vectors.push(...(await provider.embed(texts.slice(offset, offset + 32))));
  }
  return vectors;
}

async function main(): Promise<void> {
  const providers: Array<{ label: string; provider: EmbeddingProvider }> = [
    { label: "hash-256-v1", provider: new HashEmbeddingProvider() }
  ];

  const endpoint = process.env.KNOWLEDGE_EMBEDDING_ENDPOINT;
  if (endpoint) {
    const semantic = new SemanticEmbeddingProvider({
      endpoint,
      model: process.env.KNOWLEDGE_EMBEDDING_MODEL ?? "BAAI/bge-m3",
      dimensions: Number(process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS ?? 1024),
      apiKey: process.env.KNOWLEDGE_EMBEDDING_API_KEY
    });
    providers.push({
      label: `${semantic.modelId} (semantic)`,
      provider: new FallbackEmbeddingProvider(semantic, new HashEmbeddingProvider())
    });
  }

  console.log(
    `[semantic-eval] corpus=${CORPUS.length} queries=${QUERIES.length} providers=${providers.length}`
  );
  for (const { label, provider } of providers) {
    const docVectors = await embedAll(provider, CORPUS.map((doc) => doc.text));
    const docVectorById = new Map(CORPUS.map((doc, index) => [doc.id, docVectors[index]!]));

    for (const kind of ["lexical", "paraphrase"] as const) {
      const subset = QUERIES.filter((entry) => entry.kind === kind);
      const queryVectors = await embedAll(provider, subset.map((entry) => entry.query));
      let recall1 = 0;
      let recall5 = 0;
      let reciprocal = 0;
      subset.forEach((entry, index) => {
        const queryVector = queryVectors[index]!;
        const ranked = CORPUS.map((doc) => ({
          id: doc.id,
          score: cosine(queryVector, docVectorById.get(doc.id)!)
        })).sort((left, right) => right.score - left.score);
        const rank = ranked.findIndex((candidate) => candidate.id === entry.expected) + 1;
        if (rank === 1) recall1 += 1;
        if (rank > 0 && rank <= 5) recall5 += 1;
        if (rank > 0) reciprocal += 1 / rank;
      });
      console.log(
        `[semantic-eval] ${label} ${kind.padEnd(10)} R@1=${(recall1 / subset.length).toFixed(2)} R@5=${(recall5 / subset.length).toFixed(2)} MRR=${(reciprocal / subset.length).toFixed(2)} (n=${subset.length})`
      );
    }
  }
  console.log(
    "[semantic-eval] done. Configure KNOWLEDGE_EMBEDDING_ENDPOINT to score a semantic model on the same set."
  );
}

await main();
