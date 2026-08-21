import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";

import type { KnowledgeType } from "@mystcrag/design-contract";

export function ruleFingerprint(
  knowledgeType: KnowledgeType,
  subject: string,
  relation: string,
  payload: unknown
): string {
  return createHash("sha256")
    .update(JSON.stringify({ knowledgeType, subject, relation, payload }))
    .digest("hex");
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd/i
];

/**
 * SSRF guard (task book section 46): ingestion fetchers must refuse private,
 * loopback, and link-local targets. Tests against a local fixture server pass
 * allowPrivateNetworks explicitly; production keeps the block on.
 */
export async function assertPublicUrl(
  rawUrl: string,
  options?: { allowPrivateNetworks?: boolean }
): Promise<void> {
  if (options?.allowPrivateNetworks === true) return;
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`UNSUPPORTED_PROTOCOL: ${url.protocol}`);
  }
  const hostname = url.hostname.toLowerCase();
  if (PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname))) {
    throw new Error(`PRIVATE_NETWORK_BLOCKED: ${hostname}`);
  }
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(address))) {
        throw new Error(`PRIVATE_NETWORK_BLOCKED: ${hostname} resolves to ${address}`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PRIVATE_NETWORK_BLOCKED")) {
      throw error;
    }
    throw new Error(`DNS_RESOLUTION_FAILED: ${hostname}`);
  }
}

