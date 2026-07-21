import { z } from "zod";

import { AiDesignCandidateSchema } from "./ai-design-candidate.schema";

export const RecommendationProviderOutputSchema = z.strictObject({
  candidates: z.array(AiDesignCandidateSchema).length(3)
});

export type RecommendationProviderOutput = z.infer<typeof RecommendationProviderOutputSchema>;
