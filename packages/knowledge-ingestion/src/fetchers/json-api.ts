import type { StoredKnowledgeSource } from "@mystcrag/database";

import { StructuredFeedSchema, type StructuredFeed } from "../extract/candidates.js";
import { assertPublicUrl } from "../security.js";

/**
 * Structured data source (OFFICIAL_API / JSON feed): fetch + validate +
 * auto-extract. Same feed content is deduplicated later by content hash.
 */
export async function fetchStructuredFeed(
  source: StoredKnowledgeSource,
  options?: { allowPrivateNetworks?: boolean; fetchImpl?: typeof fetch }
): Promise<StructuredFeed> {
  if (source.baseUrl === undefined) {
    throw new Error(`STRUCTURED_SOURCE_REQUIRES_BASE_URL: ${source.id}`);
  }
  await assertPublicUrl(source.baseUrl, options);
  const doFetch = options?.fetchImpl ?? fetch;
  const response = await doFetch(source.baseUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`FETCH_FAILED: ${source.baseUrl} responded ${response.status}`);
  }
  const body: unknown = await response.json();
  return StructuredFeedSchema.parse(body);
}
