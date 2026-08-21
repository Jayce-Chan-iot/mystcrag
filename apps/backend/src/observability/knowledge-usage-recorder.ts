import type {
  KnowledgeUsageEventRepository,
  RecordKnowledgeUsageEventInput,
  CatalogRowInput
} from "@mystcrag/database";
import { toContractCatalogMaterials } from "@mystcrag/database";
import { catalogVersionOf } from "@mystcrag/knowledge-core";

/**
 * Collect-only knowledge usage observability (spec section 11, EPIC 12). The
 * vocabulary is closed on purpose: rule usage counts, recommendation
 * outcomes, and design apply/edit/save lifecycle signals feed later feedback
 * analysis. No read API is exposed in this epic — events are analyzed
 * offline against the append-only table.
 */
export const KNOWLEDGE_USAGE_EVENT_TYPES = [
  "recommendation.served",
  "rule.fired",
  "design.created",
  "design.updated",
  "design.saved",
  "design.evaluated",
  "design.optimized",
  "tarot.session_saved"
] as const;

export type KnowledgeUsageEventType = (typeof KNOWLEDGE_USAGE_EVENT_TYPES)[number];

export type KnowledgeUsageEvent = RecordKnowledgeUsageEventInput & {
  eventType: KnowledgeUsageEventType;
};

export type KnowledgeUsageRecorder = {
  record(events: readonly KnowledgeUsageEvent[]): Promise<void>;
};

export const NOOP_KNOWLEDGE_USAGE_RECORDER: KnowledgeUsageRecorder = {
  async record() {}
};

export function knowledgeUsageRecorderFromRepository(
  repository: Pick<KnowledgeUsageEventRepository, "recordEvents">
): KnowledgeUsageRecorder {
  return {
    async record(events) {
      await repository.recordEvents(events);
    }
  };
}

/**
 * Content-addressed catalog version for usage events, derived through the
 * shared mapper + hasher so every emitting service (recommendation, design
 * lifecycle, Tarot) anchors events to the identical catalog view.
 */
export function catalogVersionOfRows(rows: readonly CatalogRowInput[]): string {
  return catalogVersionOf(toContractCatalogMaterials(rows));
}

export type RuleUsageSource = "recommend" | "evaluate" | "optimize";

export function ruleFiredEvents(input: {
  ruleIds: readonly string[];
  actorId?: string;
  designId?: string;
  revisionNumber?: number;
  knowledgeVersion?: string;
  productCatalogVersion?: string;
  source: RuleUsageSource;
}): KnowledgeUsageEvent[] {
  return input.ruleIds.map((ruleId) => ({
    eventType: "rule.fired",
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.designId === undefined ? {} : { designId: input.designId }),
    ...(input.revisionNumber === undefined ? {} : { revisionNumber: input.revisionNumber }),
    ...(input.knowledgeVersion === undefined ? {} : { knowledgeVersion: input.knowledgeVersion }),
    ...(input.productCatalogVersion === undefined
      ? {}
      : { productCatalogVersion: input.productCatalogVersion }),
    payload: { ruleId, source: input.source }
  }));
}
