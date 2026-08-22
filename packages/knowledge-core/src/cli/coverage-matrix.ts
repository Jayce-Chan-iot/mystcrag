/**
 * Embedded snapshot of the Round 1 coverage matrix
 * (outputs/knowledge-acquisition/coverage-matrix-2026-08-22.json).
 *
 * The matrix is inlined as a TS constant so `knowledge:collect --dry-run`
 * needs no filesystem or database access. Only the fields the orchestration
 * command actually reads are embedded — not a byte-for-byte copy.
 */

export type CoverageDomain = {
  domain: string;
  target: number;
  current: number;
  missing: number;
  sourceCount: number;
  sources: string[];
};

export const COVERAGE_DOMAINS: readonly CoverageDomain[] = [
  {
    domain: "CRYSTAL_GEMOLOGY",
    target: 60,
    current: 0,
    missing: 60,
    sourceCount: 5,
    sources: [
      "source-gia-gem-encyclopedia",
      "source-gemdat-gemstone-pages",
      "source-igi-education",
      "source-journal-of-gemmology",
      "source-mohs-hardness-chart"
    ]
  },
  {
    domain: "CRYSTAL_VISUAL_PROPERTIES",
    target: 60,
    current: 0,
    missing: 60,
    sourceCount: 3,
    sources: [
      "source-gia-gem-encyclopedia",
      "source-gemdat-gemstone-pages",
      "source-britannica-symbolism"
    ]
  },
  {
    domain: "CRYSTAL_CULTURAL_SYMBOLISM",
    target: 60,
    current: 0,
    missing: 60,
    sourceCount: 4,
    sources: [
      "source-gia-gem-encyclopedia",
      "source-american-gem-society",
      "source-crystal-bible-lore",
      "source-britannica-symbolism"
    ]
  },
  {
    domain: "COLOR_THEORY",
    target: 100,
    current: 0,
    missing: 100,
    sourceCount: 4,
    sources: [
      "source-color-matters-education",
      "source-cie-color-standards",
      "source-munsell-color-education",
      "source-pantone-trend-reports"
    ]
  },
  {
    domain: "JEWELRY_DESIGN",
    target: 200,
    current: 0,
    missing: 200,
    sourceCount: 7,
    sources: [
      "source-vam-jewellery-gallery",
      "source-met-heilbrunn-jewelry",
      "source-ganoksin-bench-articles",
      "source-art-jewelry-forum",
      "source-rijksmuseum-jewelry",
      "source-bijuturu-design-proportions",
      "source-itten-art-of-color"
    ]
  },
  {
    domain: "COMPOSITION",
    target: 40,
    current: 0,
    missing: 40,
    sourceCount: 5,
    sources: [
      "source-vam-jewellery-gallery",
      "source-art-jewelry-forum",
      "source-itten-art-of-color",
      "source-bijuturu-design-proportions",
      "source-ganoksin-bench-articles"
    ]
  },
  {
    domain: "PROPORTION",
    target: 40,
    current: 0,
    missing: 40,
    sourceCount: 4,
    sources: [
      "source-bijuturu-design-proportions",
      "source-ganoksin-bench-articles",
      "source-met-heilbrunn-jewelry",
      "source-vam-jewellery-gallery"
    ]
  },
  {
    domain: "FOCAL",
    target: 30,
    current: 0,
    missing: 30,
    sourceCount: 4,
    sources: [
      "source-bijuturu-design-proportions",
      "source-art-jewelry-forum",
      "source-itten-art-of-color",
      "source-vam-jewellery-gallery"
    ]
  },
  {
    domain: "TRANSITION",
    target: 30,
    current: 0,
    missing: 30,
    sourceCount: 3,
    sources: [
      "source-bijuturu-design-proportions",
      "source-itten-art-of-color",
      "source-vam-jewellery-gallery"
    ]
  },
  {
    domain: "MATERIAL_COMPATIBILITY",
    target: 200,
    current: 0,
    missing: 200,
    sourceCount: 6,
    sources: [
      "source-gia-gem-encyclopedia",
      "source-gemdat-gemstone-pages",
      "source-mohs-hardness-chart",
      "source-stringing-wear-notes",
      "source-igi-education",
      "source-ganoksin-bench-articles"
    ]
  },
  {
    domain: "NEGATIVE_RULE",
    target: 50,
    current: 0,
    missing: 50,
    sourceCount: 4,
    sources: [
      "source-stringing-wear-notes",
      "source-gia-gem-encyclopedia",
      "source-gemdat-gemstone-pages",
      "source-bijuturu-design-proportions"
    ]
  },
  {
    domain: "STYLE",
    target: 100,
    current: 0,
    missing: 100,
    sourceCount: 5,
    sources: [
      "source-vam-jewellery-gallery",
      "source-met-heilbrunn-jewelry",
      "source-rijksmuseum-jewelry",
      "source-art-jewelry-forum",
      "source-pantone-trend-reports"
    ]
  },
  {
    domain: "WUXING",
    target: 25,
    current: 0,
    missing: 25,
    sourceCount: 3,
    sources: [
      "source-ctext-wuxing-classics",
      "source-wikipedia-reference",
      "source-britannica-symbolism"
    ]
  },
  {
    domain: "WUXING_CRYSTAL_ASSOCIATION",
    target: 60,
    current: 0,
    missing: 60,
    sourceCount: 2,
    sources: ["source-fengsuihk-wuxing-crystals", "source-wikipedia-reference"]
  },
  {
    domain: "ZODIAC",
    target: 36,
    current: 0,
    missing: 36,
    sourceCount: 3,
    sources: [
      "source-britannica-symbolism",
      "source-wikipedia-reference",
      "source-gia-gem-encyclopedia"
    ]
  },
  {
    domain: "ZODIAC_CRYSTAL_ASSOCIATION",
    target: 24,
    current: 0,
    missing: 24,
    sourceCount: 3,
    sources: [
      "source-astrologyic-zodiac-stones",
      "source-gia-gem-encyclopedia",
      "source-american-gem-society"
    ]
  },
  {
    domain: "TAROT",
    target: 78,
    current: 0,
    missing: 78,
    sourceCount: 3,
    sources: [
      "source-pictorial-key-tarot",
      "source-wikisource-pictorial-key",
      "source-bnf-tarot-marseille"
    ]
  },
  {
    domain: "TAROT_SYMBOLISM",
    target: 78,
    current: 0,
    missing: 78,
    sourceCount: 4,
    sources: [
      "source-pictorial-key-tarot",
      "source-wikisource-pictorial-key",
      "source-bnf-tarot-marseille",
      "source-met-tarot-cards"
    ]
  },
  {
    domain: "TAROT_CRYSTAL_ASSOCIATION",
    target: 22,
    current: 0,
    missing: 22,
    sourceCount: 2,
    sources: ["source-pictorial-key-tarot", "source-crystal-bible-lore"]
  },
  {
    domain: "MARKET_OBSERVATION",
    target: 40,
    current: 0,
    missing: 40,
    sourceCount: 4,
    sources: [
      "source-pantone-trend-reports",
      "source-usgs-mineral-commodity",
      "source-reddit-r-crystals",
      "source-reddit-r-beadwork"
    ]
  }
];

export type CollectBatch = {
  name: string;
  domains: readonly string[];
};

/**
 * Round 1 acquisition is partitioned into four estimated batches. Each batch
 * groups the knowledge domains its sources feed, so the orchestration command
 * can plan crawl order without a database.
 */
export const COLLECT_BATCHES: readonly CollectBatch[] = [
  {
    name: "Batch A",
    domains: [
      "CRYSTAL_GEMOLOGY",
      "CRYSTAL_VISUAL_PROPERTIES",
      "CRYSTAL_CULTURAL_SYMBOLISM",
      "MATERIAL_COMPATIBILITY",
      "NEGATIVE_RULE"
    ]
  },
  { name: "Batch B", domains: ["COLOR_THEORY"] },
  {
    name: "Batch C",
    domains: [
      "JEWELRY_DESIGN",
      "COMPOSITION",
      "PROPORTION",
      "FOCAL",
      "TRANSITION",
      "STYLE"
    ]
  },
  {
    name: "Batch D",
    domains: [
      "WUXING",
      "WUXING_CRYSTAL_ASSOCIATION",
      "ZODIAC",
      "ZODIAC_CRYSTAL_ASSOCIATION",
      "TAROT",
      "TAROT_SYMBOLISM",
      "TAROT_CRYSTAL_ASSOCIATION",
      "MARKET_OBSERVATION"
    ]
  }
];
