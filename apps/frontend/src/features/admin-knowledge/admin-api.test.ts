import assert from "node:assert/strict";
import test from "node:test";

import { createKnowledgeAdminClient, KnowledgeConsoleError } from "./admin-api";

const ENV = {
  MYSTCRAG_KNOWLEDGE_ADMIN_KEY: "console-admin-key-0123456789abcdef",
  MYSTCRAG_BACKEND_ORIGIN: "http://127.0.0.1:4100"
};

const OVERVIEW_PAYLOAD = {
  rules: {
    NEW: 0,
    EXTRACTED: 0,
    VALIDATED: 0,
    NEEDS_REVIEW: 2,
    APPROVED: 5,
    REJECTED: 0,
    CONFLICTED: 0,
    SUPERSEDED: 0
  },
  sources: {
    DISCOVERED: 0,
    NEEDS_REVIEW: 0,
    APPROVED: 2,
    REJECTED: 0,
    DISABLED: 0,
    enabled: 1
  },
  documents: 12,
  externalCandidates: 2,
  externalApprovedRules: 5,
  conflictGroups: 0,
  latestVersion: null
};

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

function fakeFetcher(status: number, payload: unknown) {
  const requests: CapturedRequest[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: CapturedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(
        new Headers(init?.headers as HeadersInit | undefined).entries()
      )
    };
    if (init?.body !== undefined) {
      request.body = String(init.body);
    }
    requests.push(request);
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
  return { fetcher, requests };
}

test("getOverview attaches the server-side admin key and parses the response", async () => {
  const { fetcher, requests } = fakeFetcher(200, OVERVIEW_PAYLOAD);
  const client = createKnowledgeAdminClient({ env: ENV, fetcher });

  const overview = await client.getOverview();

  assert.equal(overview.externalApprovedRules, 5);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "http://127.0.0.1:4100/api/admin/knowledge/overview");
  assert.equal(requests[0]!.method, "GET");
  assert.equal(requests[0]!.headers["x-admin-key"], ENV.MYSTCRAG_KNOWLEDGE_ADMIN_KEY);
});

test("actOnRule posts to the rule action endpoint with the admin key", async () => {
  const { fetcher, requests } = fakeFetcher(200, { ruleId: "rule-1", status: "APPROVED" });
  const client = createKnowledgeAdminClient({ env: ENV, fetcher });

  const result = await client.actOnRule("rule-1", "approve");

  assert.equal(result.status, "APPROVED");
  assert.equal(requests[0]!.url, "http://127.0.0.1:4100/api/admin/knowledge/rules/rule-1/approve");
  assert.equal(requests[0]!.method, "POST");
  assert.equal(requests[0]!.headers["x-admin-key"], ENV.MYSTCRAG_KNOWLEDGE_ADMIN_KEY);
});

test("editRule posts a schema-valid edit body", async () => {
  const { fetcher, requests } = fakeFetcher(200, {
    ruleId: "rule-1",
    status: "NEEDS_REVIEW",
    confidence: 0.6,
    claimType: "GEMOLOGICAL_FACT"
  });
  const client = createKnowledgeAdminClient({ env: ENV, fetcher });

  await client.editRule("rule-1", { confidence: 0.6, claimType: "GEMOLOGICAL_FACT" });

  assert.equal(requests[0]!.url, "http://127.0.0.1:4100/api/admin/knowledge/rules/rule-1/edit");
  assert.equal(
    requests[0]!.body,
    JSON.stringify({ confidence: 0.6, claimType: "GEMOLOGICAL_FACT" })
  );
});

test("listReviewQueue serializes status and limit query params", async () => {
  const { fetcher, requests } = fakeFetcher(200, { items: [], total: 0 });
  const client = createKnowledgeAdminClient({ env: ENV, fetcher });

  await client.listReviewQueue({ status: "NEEDS_REVIEW", limit: 50 });

  assert.equal(
    requests[0]!.url,
    "http://127.0.0.1:4100/api/admin/knowledge/review-queue?status=NEEDS_REVIEW&limit=50"
  );
});

test("admin API errors surface the backend error envelope", async () => {
  const { fetcher } = fakeFetcher(403, {
    error: { code: "FORBIDDEN", message: "Invalid admin key." }
  });
  const client = createKnowledgeAdminClient({ env: ENV, fetcher });

  await assert.rejects(client.getOverview(), (error: unknown) => {
    assert.ok(error instanceof KnowledgeConsoleError);
    assert.equal(error.code, "FORBIDDEN");
    assert.equal(error.message, "Invalid admin key.");
    assert.equal(error.status, 403);
    return true;
  });
});

test("network failures become a typed console error", async () => {
  const fetcher = (async () => {
    throw new Error("connection refused");
  }) as typeof fetch;
  const client = createKnowledgeAdminClient({ env: ENV, fetcher });

  await assert.rejects(client.getOverview(), (error: unknown) => {
    assert.ok(error instanceof KnowledgeConsoleError);
    assert.equal(error.code, "NETWORK_ERROR");
    return true;
  });
});

test("the client fails closed when no admin key is configured", async () => {
  const { fetcher, requests } = fakeFetcher(200, OVERVIEW_PAYLOAD);
  const client = createKnowledgeAdminClient({ env: {}, fetcher });

  await assert.rejects(client.getOverview(), (error: unknown) => {
    assert.ok(error instanceof KnowledgeConsoleError);
    assert.equal(error.code, "NOT_CONFIGURED");
    return true;
  });
  assert.equal(requests.length, 0, "no request may leave the server without a key");
});
