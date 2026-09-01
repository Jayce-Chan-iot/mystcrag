/**
 * Privacy-safe authentication event logging (TASK-AUTH-005).
 *
 * Frozen contract (AUTH_SESSION_CONTRACT.md §9): structured events may carry a request
 * id, a fixed status/error category and non-sensitive operational state only. They must
 * NEVER contain cookies, tokens, codes, verifiers, nonce/state values, client secrets,
 * raw provider profiles, provider error descriptions, raw callback queries or returnTo
 * values, subject/issuer raw values, claims, or email/display name.
 *
 * Event semantics are deliberately distinct (never collapsed into one bucket):
 * - session missing vs session expired/malformed vs renewal rejected/revoked vs
 *   Backend token verification failure vs dependency failure vs origin rejection vs
 *   open-redirect rejection vs session rotation.
 *
 * This module enforces the privacy whitelist structurally:
 * - Event names and categories are closed literal sets; unknown values throw.
 * - The record builder copies ONLY the whitelisted fields (event, category, requestId,
 *   outcome) — any extra property on the input is dropped, so an accidental caller
 *   object spread cannot smuggle sensitive material into the log sink.
 * - The sink receives the sanitized record only.
 */

export const AUTH_EVENT_NAMES = [
  "auth.sign_in",
  "auth.logout",
  "auth.callback_failed",
  "auth.dependency_failed",
  "auth.session_invalid",
  "auth.session_missing",
  "auth.session_rotation",
  "auth.renewal_rejected",
  "auth.verification_failed",
  "auth.origin_rejected",
  "auth.open_redirect_rejected"
] as const;

export type AuthEventName = (typeof AUTH_EVENT_NAMES)[number];

export const AUTH_EVENT_CATEGORIES = [
  "authentication",
  "dependency",
  "session_missing",
  "session_expired_or_malformed",
  "session_rotation",
  "renewal_revoked",
  "verification_failed",
  "origin_rejected",
  "open_redirect"
] as const;

export type AuthEventCategory = (typeof AUTH_EVENT_CATEGORIES)[number];

export type AuthEventOutcome = "success" | "failure";

export type AuthEventInput = {
  readonly category: AuthEventCategory;
  readonly requestId?: string;
  readonly outcome?: AuthEventOutcome;
};

/** Exactly the fields an auth event record may carry. Nothing else is ever emitted. */
export type AuthEventRecord = {
  readonly event: AuthEventName;
  readonly category: AuthEventCategory;
  readonly requestId?: string;
  readonly outcome?: AuthEventOutcome;
};

export type AuthEventSink = (record: AuthEventRecord) => void;

export type AuthEventLogger = (event: AuthEventName, input: AuthEventInput) => void;

const EVENT_NAME_SET: ReadonlySet<string> = new Set(AUTH_EVENT_NAMES);
const CATEGORY_SET: ReadonlySet<string> = new Set(AUTH_EVENT_CATEGORIES);

function defaultAuthEventSink(record: AuthEventRecord): void {
  // One line per event; the record contains only whitelisted, non-sensitive fields.
  console.info(JSON.stringify(record));
}

/**
 * Builds an auth event logger over a sink. Throws on unknown event names or categories
 * (programmer error — never silently log an untyped event) and strips every field that
 * is not part of the whitelist before the sink sees the record.
 */
export function createAuthEventLogger(sink: AuthEventSink = defaultAuthEventSink): AuthEventLogger {
  return function logAuthEvent(event: AuthEventName, input: AuthEventInput): void {
    if (!EVENT_NAME_SET.has(event)) {
      throw new Error("Unknown auth event name");
    }
    if (!CATEGORY_SET.has(input.category)) {
      throw new Error("Unknown auth event category");
    }

    // Whitelist copy: only event/category/requestId/outcome can ever reach the sink.
    const record: AuthEventRecord = { event, category: input.category };
    if (typeof input.requestId === "string" && input.requestId.length > 0) {
      (record as { requestId: string }).requestId = input.requestId;
    }
    if (input.outcome === "success" || input.outcome === "failure") {
      (record as { outcome: AuthEventOutcome }).outcome = input.outcome;
    }
    sink(record);
  };
}

/** Shared default logger used by the auth routes. */
export const logAuthEvent: AuthEventLogger = createAuthEventLogger();
