/**
 * Session status state machine (pure).
 *
 * Extracted from `use-session.ts` so every status transition is testable without a DOM.
 * The hook remains the only place that performs the fetch and touches React state.
 */

export type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "error";

export type SessionStatusEvent =
  /** The session endpoint answered 2xx with a projection body. */
  | { readonly type: "resolved"; readonly authenticated: boolean }
  /** The session endpoint failed (network error or non-2xx). */
  | { readonly type: "failed" }
  /** A new fetch cycle starts. */
  | { readonly type: "reset" };

export const INITIAL_SESSION_STATUS: SessionStatus = "loading";

/**
 * Classifies a successful /auth/session projection body. Only an explicit
 * `authenticated === true` counts as authenticated; anything else is unauthenticated.
 */
export function classifySessionResponse(body: { authenticated?: unknown }): SessionStatus {
  return body.authenticated === true ? "authenticated" : "unauthenticated";
}

/**
 * Reducer for the AuthStatus state machine. A fetch cycle always starts in "loading"
 * (initial mount or manual refresh), so "resolved"/"failed" are consumed only from
 * "loading"; outcomes never overwrite a settled state within the same cycle.
 */
export function reduceSessionStatus(state: SessionStatus, event: SessionStatusEvent): SessionStatus {
  switch (event.type) {
    case "reset":
      return "loading";
    case "resolved":
      if (state !== "loading") return state;
      return event.authenticated ? "authenticated" : "unauthenticated";
    case "failed":
      if (state !== "loading") return state;
      return "error";
  }
}
