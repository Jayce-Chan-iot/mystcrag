/**
 * Protected Tarot flow helper for AUTH-006.
 *
 * Drives the REAL backend Tarot contract (create → select → reveal) through the BFF
 * with the browser's session cookies — the same /api/tarot/** endpoints the frontend
 * uses. SINGLE spread requires exactly one selection on the GUIDANCE slot before the
 * draw can be revealed.
 */

import { bffClient, type ApiResponse } from "./api";
import type { Page } from "@playwright/test";

export type TarotSession = {
  sessionId: string;
  revision: number;
  status: string;
};

function requestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function createTarotSession(page: Page): Promise<TarotSession> {
  const api = bffClient(page);
  const response = await api.post("/api/tarot/sessions", {
    requestId: requestId("tarot"),
    spreadType: "SINGLE",
    theme: "SELF_GROWTH"
  });
  if (response.status !== 200) {
    throw new Error(`Tarot session creation failed: ${response.status} ${response.body}`);
  }
  const session = response.json<{ session: TarotSession }>().session;
  return session;
}

export async function selectGuidanceCard(page: Page, sessionId: string): Promise<TarotSession> {
  const api = bffClient(page);
  const current = await api.get(`/api/tarot/sessions/${encodeURIComponent(sessionId)}`);
  const revision = current.json<{ session: TarotSession }>().session.revision;
  const response = await api.post(
    `/api/tarot/sessions/${encodeURIComponent(sessionId)}/select`,
    {
      requestId: requestId("tarot-select"),
      slot: "GUIDANCE",
      displayedPosition: 42,
      expectedRevision: revision,
      operationId: requestId("tarot-op")
    }
  );
  if (response.status !== 200) {
    throw new Error(`Tarot select failed: ${response.status} ${response.body}`);
  }
  return response.json<{ session: TarotSession }>().session;
}

export async function revealTarotSession(page: Page, sessionId: string): Promise<ApiResponse> {
  const api = bffClient(page);
  const current = await api.get(`/api/tarot/sessions/${encodeURIComponent(sessionId)}`);
  const revision = current.json<{ session: TarotSession }>().session.revision;
  return api.post(`/api/tarot/sessions/${encodeURIComponent(sessionId)}/reveal`, {
    requestId: requestId("tarot-reveal"),
    expectedRevision: revision
  });
}

export async function getTarotSession(page: Page, sessionId: string): Promise<ApiResponse> {
  const api = bffClient(page);
  return api.get(`/api/tarot/sessions/${encodeURIComponent(sessionId)}`);
}
