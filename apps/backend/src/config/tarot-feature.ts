/** Exact, fail-closed rollout semantics for the server-owned Tarot flag. */
export function resolveTarotFeatureEnabled(value: string | undefined): boolean {
  return value === "true";
}
