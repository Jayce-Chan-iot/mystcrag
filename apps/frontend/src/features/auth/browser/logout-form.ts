/**
 * Logout is a top-level POST form navigation to /auth/logout (never fetch), so the
 * browser itself follows the server's 303 See Other to the Auth0 logout URL.
 *
 * The DOM form creation/submission is a single injectable helper so the contract
 * (method=POST, action=/auth/logout, append to body, submit) is testable against a
 * lightweight fake document — no DOM library required. `useSession` calls this exact
 * helper.
 */

import { buildLogoutFormSpec } from "../model/auth-actions";

/** Minimal structural surface of the form element the helper needs. */
export type LogoutFormElementLike = {
  method: string;
  action: string;
  style: { display: string };
  submit(): void;
};

/**
 * Minimal structural surface of the document the helper needs. The appendChild
 * parameter is `unknown` so the real DOM `Document` (whose `appendChild` accepts
 * `Node`) stays structurally compatible without widening `LogoutFormElementLike`.
 */
export type LogoutFormDocumentLike = {
  createElement(tag: "form"): LogoutFormElementLike;
  body: { appendChild(element: unknown): unknown };
};

export function submitLogoutForm(doc: LogoutFormDocumentLike = document): void {
  const spec = buildLogoutFormSpec();
  const form = doc.createElement("form");
  form.method = spec.method;
  form.action = spec.action;
  form.style.display = spec.display;
  doc.body.appendChild(form);
  form.submit();
}
