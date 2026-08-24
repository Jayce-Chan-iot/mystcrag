import { createHash } from "node:crypto";

import {
  ExtractionRelationSchema,
  KnowledgeTypeSchema,
  isRelationAllowedForKnowledgeType,
  knowledgeDomainForType,
  type JsonValue,
  type KnowledgeType
} from "@mystcrag/design-contract";
import { z } from "zod";

import {
  confidenceFor,
  isCandidateAllowedForSource,
  type ExtractorInput,
  type KnowledgeExtractor,
  type KnowledgeRuleSeed
} from "./extractor.js";

export type SemanticExtractorOptions = {
  /** OpenAI-compatible chat-completions URL. Undefined keeps the extractor dormant. */
  endpoint?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_DOCUMENT_CHARS = 12_000;
const SEMANTIC_CONFIDENCE_CAP = 0.85;

const LlmCandidateSchema = z.strictObject({
  knowledgeType: KnowledgeTypeSchema,
  relation: ExtractionRelationSchema,
  subject: z.string().trim().min(1).max(160),
  payload: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().trim().min(1).max(500)
});

const ChatResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.union([z.string(), z.null()]) }) }))
    .min(1)
});

const SYSTEM_PROMPT = `You extract bracelet design knowledge candidates from a document.
Return STRICT JSON: {"candidates":[{"knowledgeType":string,"relation":string,"subject":string,"payload":object|null,"confidence":number,"evidence":string}]}.
knowledgeType must be one of COLOR_THEORY, MATERIAL_COMPATIBILITY, STYLE_RULE, PROPORTION_RULE, COMPOSITION_RULE, TRANSITION_RULE, FOCAL_RULE, NEGATIVE_RULE, CULTURAL_SYMBOLISM, TAROT, MARKET_OBSERVATION.
relation must be one of pairs-well-with, conflicts-with, avoid-exposure, care-instruction, symbolizes, suits-style, proportion-of, transitions-to, trending-in, and must be a plausible pair with knowledgeType.
subject must be a taxonomy identifier like "color:purple" or "material:quartz", or a kebab-case id.
evidence MUST be copied VERBATIM from the document text; candidates whose evidence is not verbatim will be discarded.
Only extract statements explicitly supported by the text. No more than 10 candidates.`;

/**
 * LLM-backed extraction over an OpenAI-compatible chat endpoint (Quality
 * Phase Q2). Dormant until an endpoint is configured; every surviving
 * candidate passed three gates — strict schema validation, the relation ×
 * knowledgeType vocabulary, and a verbatim-evidence check that locates the
 * claimed sentence inside the document (hallucinated evidence is dropped,
 * never stored). Candidates are NEEDS_REVIEW by the provenance rule
 * (`source = AI` can never be a final source).
 */
export class SemanticExtractor implements KnowledgeExtractor {
  readonly id = "semantic-extractor-v1";
  readonly method = "semantic" as const;
  private readonly endpoint?: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SemanticExtractorOptions) {
    this.endpoint = options.endpoint;
    this.model = options.model ?? DEFAULT_MODEL;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get active(): boolean {
    return this.endpoint !== undefined;
  }

  async extract(input: ExtractorInput): Promise<KnowledgeRuleSeed[]> {
    if (this.endpoint === undefined) return [];

    const response = await this.requestCompletion(input);
    const candidates = this.parseCandidates(response);
    return this.materialize(candidates, input);
  }

  private async requestCompletion(input: ExtractorInput): Promise<string | null> {
    const headers = new Headers({ "content-type": "application/json" });
    if (this.apiKey !== undefined) {
      headers.set("authorization", `Bearer ${this.apiKey}`);
    }
    const response = await this.fetchImpl(this.endpoint!, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `${input.title}\n\n${input.contentText.slice(0, MAX_DOCUMENT_CHARS)}`
          }
        ]
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) {
      throw new Error(`EXTRACTION_REQUEST_FAILED: endpoint responded ${response.status}`);
    }
    const body = ChatResponseSchema.parse(await response.json());
    return body.choices[0]?.message.content ?? null;
  }

  private parseCandidates(content: string | null): z.infer<typeof LlmCandidateSchema>[] {
    if (content === null) return [];
    const stripped = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end <= start) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped.slice(start, end + 1));
    } catch {
      return [];
    }
    const envelope = z
      .object({ candidates: z.array(z.unknown()).max(50) })
      .passthrough()
      .safeParse(parsed);
    if (!envelope.success) return [];
    const valid: z.infer<typeof LlmCandidateSchema>[] = [];
    for (const item of envelope.data.candidates) {
      const candidate = LlmCandidateSchema.safeParse(item);
      if (candidate.success) valid.push(candidate.data);
    }
    return valid;
  }

  private materialize(
    candidates: z.infer<typeof LlmCandidateSchema>[],
    input: ExtractorInput
  ): KnowledgeRuleSeed[] {
    const seeds: KnowledgeRuleSeed[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!isRelationAllowedForKnowledgeType(candidate.relation, candidate.knowledgeType)) continue;
      const knowledgeDomain = knowledgeDomainForType(candidate.knowledgeType);
      if (!isCandidateAllowedForSource(knowledgeDomain, input.source)) continue;

      const evidenceStart = input.contentText.indexOf(candidate.evidence);
      if (evidenceStart === -1) continue;
      const evidenceEnd = evidenceStart + candidate.evidence.length;

      const payload = {
        ...(candidate.payload ?? {}),
        extraction: {
          extractor: this.id,
          method: this.method,
          evidence: [
            {
              documentId: input.documentId,
              sentence: candidate.evidence,
              startOffset: evidenceStart,
              endOffset: evidenceEnd
            }
          ]
        }
      };
      // Fingerprint covers knowledge identity, not the extraction metadata —
      // the same claim from a different sentence stays one rule.
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            knowledgeType: candidate.knowledgeType,
            subject: candidate.subject,
            relation: candidate.relation,
            payload: candidate.payload ?? {}
          })
        )
        .digest("hex");
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      seeds.push({
        id: `cand-${fingerprint.slice(0, 24)}`,
        sourceId: input.source.sourceId,
        knowledgeType: candidate.knowledgeType as KnowledgeType,
        knowledgeDomain,
        subject: candidate.subject,
        relation: candidate.relation,
        payload: payload as JsonValue,
        conditions: {},
        confidence: confidenceFor(
          candidate.confidence,
          input.source.reliabilityLevel,
          SEMANTIC_CONFIDENCE_CAP
        ),
        status: "NEEDS_REVIEW",
        sourceRefs: [{ sourceId: input.source.sourceId, documentId: input.documentId }],
        version: 1,
        fingerprint,
        createdAt: input.fetchedAt,
        updatedAt: input.fetchedAt
      });
    }
    return seeds;
  }
}

export type ExtractionEnv = {
  KNOWLEDGE_EXTRACTION_ENDPOINT?: string;
  KNOWLEDGE_EXTRACTION_MODEL?: string;
  KNOWLEDGE_EXTRACTION_API_KEY?: string;
};

export function createSemanticExtractorFromEnv(
  env: ExtractionEnv = process.env
): SemanticExtractor {
  return new SemanticExtractor({
    endpoint: env.KNOWLEDGE_EXTRACTION_ENDPOINT,
    model: env.KNOWLEDGE_EXTRACTION_MODEL,
    apiKey: env.KNOWLEDGE_EXTRACTION_API_KEY
  });
}
