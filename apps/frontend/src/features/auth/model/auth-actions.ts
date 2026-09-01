/**
 * Pure browser-authentication action builders (no DOM access).
 *
 * Extracted from `use-session.ts` so the login-returnTo and logout-POST contracts are
 * testable with the repository's existing test runner. The browser touchpoints
 * (`window.location`, form creation) are applied by the hook; these functions only
 * compute values.
 */

export type BrowserLocation = {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
};

/**
 * The returnTo value for login navigations: the current location exactly as the user
 * sees it (pathname + search + hash). The home page produces "/". Server-side
 * `validateReturnTo` remains the single trust boundary (absolute URLs, `//`,
 * backslashes and encoded bypasses are rejected server-side).
 */
export function buildReturnTo(location: BrowserLocation): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

/**
 * Builds the same-origin login href carrying the URL-encoded returnTo. Login always
 * goes through the server-validated `/auth/login?returnTo=` endpoint.
 */
export function buildLoginHref(location: BrowserLocation): string {
  return `/auth/login?returnTo=${encodeURIComponent(buildReturnTo(location))}`;
}

/**
 * Logout contract: a top-level POST form navigation to /auth/logout (never fetch),
 * so the browser itself follows the server's 303 See Other to the Auth0 logout URL.
 */
export const LOGOUT_FORM_SPEC = {
  method: "POST",
  action: "/auth/logout",
  display: "none"
} as const;

export type LogoutFormSpec = typeof LOGOUT_FORM_SPEC;

export function buildLogoutFormSpec(): LogoutFormSpec {
  return LOGOUT_FORM_SPEC;
}
