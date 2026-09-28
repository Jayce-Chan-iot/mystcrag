/** Exact, fail-closed rollout semantics for the server-owned Oracle flag. */
export function resolveOracleFeatureEnabled(value: string | undefined): boolean {
  return value === "true";
}
