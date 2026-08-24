import { z } from "zod";

import { AiBeadLayoutCandidateSchema } from "./ai-bead-layout-candidate.schema";

export const RecommendationProviderOutputSchema = z.strictObject({
  candidates: z.array(AiBeadLayoutCandidateSchema).length(3)
});

export type RecommendationProviderOutput = z.infer<typeof RecommendationProviderOutputSchema>;
