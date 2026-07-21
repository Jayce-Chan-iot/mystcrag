import type { EmotionTag, StyleTag } from "../contracts/recommendation";

export type TemplateSlot = "PRIMARY" | "SECONDARY" | "ACCENT";

export type DesignDnaFixture = {
  readonly designId: string;
  readonly name: string;
  readonly theme: string;
  readonly emotionTags: readonly EmotionTag[];
  readonly styleTags: readonly StyleTag[];
  readonly colorPalette: readonly string[];
  readonly sequence: readonly TemplateSlot[];
  readonly culturalReference: string;
  readonly designInspiration: string;
  readonly nonScientificEffect: true;
  readonly popularityScore: number;
};

const sequences = {
  alternating: ["PRIMARY", "SECONDARY", "PRIMARY", "ACCENT", "PRIMARY", "SECONDARY", "PRIMARY", "ACCENT", "PRIMARY", "SECONDARY", "PRIMARY", "ACCENT"],
  centered: ["PRIMARY", "PRIMARY", "SECONDARY", "PRIMARY", "SECONDARY", "ACCENT", "ACCENT", "SECONDARY", "PRIMARY", "SECONDARY", "PRIMARY", "PRIMARY"],
  gradient: ["PRIMARY", "PRIMARY", "PRIMARY", "SECONDARY", "SECONDARY", "ACCENT", "ACCENT", "SECONDARY", "SECONDARY", "PRIMARY", "PRIMARY", "PRIMARY"],
  asymmetric: ["ACCENT", "PRIMARY", "PRIMARY", "SECONDARY", "PRIMARY", "PRIMARY", "ACCENT", "SECONDARY", "PRIMARY", "ACCENT", "PRIMARY", "SECONDARY"]
} as const satisfies Readonly<Record<string, readonly TemplateSlot[]>>;

export const designDnaFixtures: readonly DesignDnaFixture[] = [
  { designId: "template-rain-after-blue", name: "Rain After Blue", theme: "clear rain", emotionTags: ["calm", "renewal"], styleTags: ["minimal", "eastern-contemporary"], colorPalette: ["blue", "white", "clear"], sequence: sequences.alternating, culturalReference: "rain-cleared sky", designInspiration: "translucent blue and white intervals", nonScientificEffect: true, popularityScore: 96 },
  { designId: "template-moonlit-tide", name: "Moonlit Tide", theme: "moonlit water", emotionTags: ["connection", "calm"], styleTags: ["romantic", "minimal"], colorPalette: ["white", "blue", "iridescent"], sequence: sequences.centered, culturalReference: "moonlit water", designInspiration: "luminous center and soft reflections", nonScientificEffect: true, popularityScore: 93 },
  { designId: "template-ink-mountain", name: "Ink Mountain", theme: "ink landscape", emotionTags: ["focus", "calm"], styleTags: ["eastern-contemporary", "minimal"], colorPalette: ["black", "gray", "clear"], sequence: sequences.gradient, culturalReference: "ink landscape composition", designInspiration: "neutral depth from dark to clear", nonScientificEffect: true, popularityScore: 91 },
  { designId: "template-spring-blossom", name: "Spring Blossom", theme: "spring petals", emotionTags: ["joy", "connection"], styleTags: ["romantic", "natural"], colorPalette: ["pink", "white", "green"], sequence: sequences.asymmetric, culturalReference: "spring blossom viewing", designInspiration: "soft pink clusters with fresh green", nonScientificEffect: true, popularityScore: 90 },
  { designId: "template-golden-hour", name: "Golden Hour", theme: "late sunlight", emotionTags: ["confidence", "joy"], styleTags: ["modern", "vintage"], colorPalette: ["gold", "yellow", "brown"], sequence: sequences.centered, culturalReference: "late afternoon sunlight", designInspiration: "golden focal beads over warm neutrals", nonScientificEffect: true, popularityScore: 89 },
  { designId: "template-forest-breath", name: "Forest Breath", theme: "forest layers", emotionTags: ["renewal", "calm"], styleTags: ["natural", "minimal"], colorPalette: ["green", "brown", "clear"], sequence: sequences.gradient, culturalReference: "forest canopy layers", designInspiration: "fresh greens grounded by neutral translucency", nonScientificEffect: true, popularityScore: 88 },
  { designId: "template-twilight-violet", name: "Twilight Violet", theme: "violet dusk", emotionTags: ["focus", "confidence"], styleTags: ["vintage", "eastern-contemporary"], colorPalette: ["purple", "gray", "gold"], sequence: sequences.asymmetric, culturalReference: "violet mountain dusk", designInspiration: "deep violet focal cadence", nonScientificEffect: true, popularityScore: 87 },
  { designId: "template-river-jade", name: "River Jade", theme: "blue-green river", emotionTags: ["renewal", "connection"], styleTags: ["eastern-contemporary", "natural"], colorPalette: ["green", "blue", "white"], sequence: sequences.alternating, culturalReference: "river and jade color traditions", designInspiration: "balanced blue-green repetition", nonScientificEffect: true, popularityScore: 86 },
  { designId: "template-vermilion-mark", name: "Vermilion Mark", theme: "vermilion craft", emotionTags: ["joy", "confidence"], styleTags: ["eastern-contemporary", "vintage"], colorPalette: ["red", "orange", "black"], sequence: sequences.centered, culturalReference: "vermilion craft color", designInspiration: "red accents against a dark structure", nonScientificEffect: true, popularityScore: 85 },
  { designId: "template-silver-mist", name: "Silver Mist", theme: "mist and metal", emotionTags: ["calm", "focus"], styleTags: ["modern", "minimal"], colorPalette: ["gray", "blue", "white"], sequence: sequences.gradient, culturalReference: "morning mist", designInspiration: "cool neutral rhythm with subtle flashes", nonScientificEffect: true, popularityScore: 84 },
  { designId: "template-wine-and-rose", name: "Wine and Rose", theme: "deep floral color", emotionTags: ["connection", "confidence"], styleTags: ["romantic", "vintage"], colorPalette: ["wine", "pink", "gold"], sequence: sequences.asymmetric, culturalReference: "dark floral textile color", designInspiration: "wine-red center with pink transitions", nonScientificEffect: true, popularityScore: 83 },
  { designId: "template-prism-garden", name: "Prism Garden", theme: "layered color", emotionTags: ["joy", "renewal"], styleTags: ["modern", "natural"], colorPalette: ["purple", "green", "clear"], sequence: sequences.alternating, culturalReference: "garden light through glass", designInspiration: "alternating translucent garden colors", nonScientificEffect: true, popularityScore: 82 }
] as const;
