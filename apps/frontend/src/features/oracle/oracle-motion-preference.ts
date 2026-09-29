/**
 * Returning-user reveal preference for the Star Oracle ritual.
 *
 * Only a versioned boolean is persisted. The optional question, session id,
 * cast payload and any other identifier must never be written to storage.
 */
export const ORACLE_FULL_MOTION_STORAGE_KEY = "mystcrag:oracle:full-motion:v1";

export const ORACLE_FULL_REVEAL_MS = 3200;
export const ORACLE_SHORT_REVEAL_MS = 400;
export const MAX_ORACLE_REVEAL_MS = 4000;

export type OracleMotionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type OracleMotionInput = {
  prefersReducedMotion: boolean;
  fullMotionEnabled: boolean;
};

export function readOracleFullMotionPreference(storage: OracleMotionStorage): boolean {
  try {
    const raw = storage.getItem(ORACLE_FULL_MOTION_STORAGE_KEY);
    if (raw === "false") return false;
    return true;
  } catch {
    return true;
  }
}

export function writeOracleFullMotionPreference(
  storage: OracleMotionStorage,
  enabled: boolean
): void {
  storage.setItem(ORACLE_FULL_MOTION_STORAGE_KEY, enabled ? "true" : "false");
}

export function shouldPlayFullOracleReveal({
  prefersReducedMotion,
  fullMotionEnabled
}: OracleMotionInput): boolean {
  if (prefersReducedMotion) return false;
  return fullMotionEnabled;
}

export function resolveOracleRevealDurationMs(input: OracleMotionInput): number {
  return shouldPlayFullOracleReveal(input) ? ORACLE_FULL_REVEAL_MS : ORACLE_SHORT_REVEAL_MS;
}
