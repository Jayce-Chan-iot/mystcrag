export function resolveMockMode({
  nodeEnv = process.env.NODE_ENV,
  flag = process.env.NEXT_PUBLIC_MYSTCRAG_MOCK_API
}: {
  nodeEnv?: string;
  flag?: string;
} = {}): boolean {
  return nodeEnv !== "production" && flag === "true";
}

export const isMockApiEnabled = resolveMockMode();

export function resolveAccessToken(): string {
  return process.env.NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN?.trim() ?? "";
}

/** Exact, fail-closed rollout semantics shared with Backend startup. */
export function resolveTarotFeatureEnabled(value: string | undefined): boolean {
  return value === "true";
}

/** Server-rendered rollout gate. Client-visible environment flags are intentionally ignored. */
export function isTarotFeatureEnabled(): boolean {
  if (typeof window !== "undefined") return false;
  return resolveTarotFeatureEnabled(process.env.MYSTCRAG_TAROT_ENABLED);
}
