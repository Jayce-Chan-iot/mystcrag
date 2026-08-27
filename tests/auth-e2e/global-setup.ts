/**
 * AUTH-006 global setup: boots the fully isolated stack for this run.
 *
 * Everything (database, provider, relay, backend, frontend) is created from scratch
 * with a unique run id; nothing from the developer workspace is reused. Failures
 * here abort the whole run BEFORE any spec executes, and the stack is torn down
 * even when setup fails halfway.
 */

import { startIsolatedStack } from "./fixtures/stack";

export default async function globalSetup(): Promise<void> {
  const state = await startIsolatedStack();
  console.log(`[auth-006] run ${state.runId} ready`);
  console.log(`[auth-006]   frontend   ${state.urls.frontend}`);
  console.log(`[auth-006]   backend    ${state.urls.backend}`);
  console.log(`[auth-006]   provider   ${state.urls.providerIssuer}`);
  console.log(`[auth-006]   database   ${state.database.name}`);
}
