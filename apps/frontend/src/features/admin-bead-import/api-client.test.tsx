import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ASSET_MANIFEST_LIMITS,
  AssetImportSessionResponseSchema,
  type AssetImportSessionResponse,
  type ListAssetImportSessionsResponse,
  type PublishBeadImageGroupRequest,
  type ReviewProcessedAssetRequest,
  type UploadAssetFileResponse
} from "@mystcrag/design-contract";

import {
  BEAD_IMPORT_BROWSER_PROXY_PREFIX,
  BeadImportApiError,
  createBeadImportClient,
  newIdempotencyKey,
  sanitizeSession
} from "./api-client";

type RecordedCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | undefined;
};

function makeHarness(options: {
  status?: number;
  payload?: unknown;
  rawBody?: string;
  contentType?: string;
  throws?: Error;
} = {}) {
  const calls: RecordedCall[] = [];
  const client = createBeadImportClient({
    fetcher: async (url, init) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers,
        body: init?.body,
        signal: init?.signal ?? undefined
      });
      if (options.throws !== undefined) {
        throw options.throws;
      }
      return new Response(options.rawBody ?? JSON.stringify(options.payload ?? {}), {
        status: options.status ?? 200,
        headers: { "content-type": options.contentType ?? "application/json" }
      });
    }
  });
  return { client, calls };
}

function headerNames(call: RecordedCall): string[] {
  return Object.keys(call.headers).sort();
}

const SESSION: AssetImportSessionResponse = {
  sessionId: "session-1",
  state: "ARCHIVING",
  createdAt: "2026-09-06T08:00:00.000Z",
  updatedAt: "2026-09-06T08:05:00.000Z",
  lastVerifiedCheckpoint: "ARCHIVED",
  declaredFileCount: 1,
  uploadedFileCount: 1,
  archivedFileCount: 1,
  failedFileCount: 0,
  declaredBytes: 2048,
  uploadedBytes: 2048,
  files: [
    {
      fileId: "file-1",
      clientFileId: "client-file-1",
      relativePath: "batch-01/bead-01.jpg",
      kind: "JPEG",
      state: "ARCHIVED",
      byteSize: 2048,
      sha256: "a".repeat(64),
      archiveKey: "asset-archive/2026-09-06/session-1/file-1.jpg"
    }
  ],
  groups: []
};

const LIST_PAYLOAD: ListAssetImportSessionsResponse = {
  sessions: [
    {
      sessionId: "session-1",
      state: "NEEDS_REVIEW",
      lastVerifiedCheckpoint: "GROUPED",
      declaredFileCount: 12,
      archivedFileCount: 12,
      failedFileCount: 0,
      groupCount: 3,
      createdAt: "2026-09-06T08:00:00.000Z",
      updatedAt: "2026-09-06T08:30:00.000Z"
    }
  ],
  nextCursor: null
};

const UPLOAD_PAYLOAD: UploadAssetFileResponse = {
  fileId: "file-1",
  uploadStatus: "ARCHIVED",
  byteSize: 2048,
  sha256: "a".repeat(64),
  archiveKey: "asset-archive/2026-09-06/session-1/file-1.jpg",
  archivedAt: "2026-09-06T08:06:00.000Z"
};

test("the browser talks to the cookie scoped proxy and never sets the admin key", async () => {
  const { client, calls } = makeHarness({ payload: LIST_PAYLOAD });
  await client.listSessions({});
  assert.equal(BEAD_IMPORT_BROWSER_PROXY_PREFIX, "/admin/bead-import/proxy");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "/admin/bead-import/proxy/sessions");
  assert.equal(calls[0]?.method, "GET");
  assert.deepEqual(headerNames(calls[0] as RecordedCall), []);
  assert.equal(calls[0]?.body, undefined);
});

test("the client module never names the admin key header or its environment variables", () => {
  const source = readFileSync(join(__dirname, "api-client.ts"), "utf8");
  assert.ok(!source.includes("x-admin-key"));
  assert.ok(!source.includes("MYSTCRAG_ASSET_ADMIN_KEY"));
  assert.ok(!source.includes("ASSET_ADMIN_API_KEY"));
  assert.ok(!source.includes("MYSTCRAG_BACKEND_ORIGIN"));
  assert.ok(!source.includes("process.env"));
});

test("list sessions encodes the state filter and cursor pagination", async () => {
  const { client, calls } = makeHarness({ payload: LIST_PAYLOAD });
  const result = await client.listSessions({ state: "NEEDS_REVIEW", limit: 25, cursor: "session-1" });
  assert.deepEqual(result, LIST_PAYLOAD);
  assert.equal(calls[0]?.url, "/admin/bead-import/proxy/sessions?state=NEEDS_REVIEW&limit=25&cursor=session-1");

  const empty = makeHarness({ payload: LIST_PAYLOAD });
  await empty.client.listSessions({});
  assert.equal(empty.calls[0]?.url, "/admin/bead-import/proxy/sessions");
});

test("a list response that violates the contract is rejected", async () => {
  const { client } = makeHarness({ payload: { sessions: [], nextCursor: null, extra: true } });
  await assert.rejects(() => client.listSessions({}), (error: unknown) => {
    assert.ok(error instanceof BeadImportApiError);
    assert.equal(error.code, "CONTRACT_VIOLATION");
    assert.equal(error.retryable, false);
    assert.ok(!error.message.includes("extra"));
    return true;
  });
});

test("session reads strip every private archive key before the UI sees them", async () => {
  const { client } = makeHarness({ payload: SESSION });
  const session = await client.getSession("session-1");
  assert.equal(JSON.stringify(session).includes("asset-archive"), false);
  assert.equal(session.files[0]?.archiveKey, undefined);
  assert.equal(session.files[0]?.relativePath, "batch-01/bead-01.jpg");
  assert.equal(AssetImportSessionResponseSchema.safeParse(session).success, true);
  assert.equal(sanitizeSession(SESSION).files[0]?.archiveKey, undefined);
});

test("identifiers are encoded so they cannot escape the proxy path", async () => {
  const { client, calls } = makeHarness({ payload: SESSION });
  await client.getSession("a/../b");
  assert.equal(calls[0]?.url, "/admin/bead-import/proxy/sessions/a%2F..%2Fb");
  assert.ok(!(calls[0]?.url ?? "").includes("/sessions/a/../b"));
});

test("an abort signal reaches the underlying request", async () => {
  const { client, calls } = makeHarness({ payload: SESSION });
  const controller = new AbortController();
  await client.getSession("session-1", { signal: controller.signal });
  assert.equal(calls[0]?.signal, controller.signal);
});

test("uploading streams the body untouched with an explicit content length", async () => {
  const { client, calls } = makeHarness({ payload: UPLOAD_PAYLOAD });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    }
  });
  const result = await client.uploadFileContent("session-1", "file-1", {
    body: stream,
    byteLength: 2048,
    contentType: "image/jpeg",
    sha256: "a".repeat(64)
  });
  const call = calls[0] as RecordedCall;
  assert.equal(call.method, "PUT");
  assert.equal(call.url, "/admin/bead-import/proxy/sessions/session-1/files/file-1/content");
  assert.equal(call.body, stream, "the stream must be forwarded by identity, never buffered");
  assert.deepEqual(call.headers, {
    "content-length": "2048",
    "content-type": "image/jpeg",
    "x-content-sha256": "a".repeat(64)
  });
  assert.equal((result as { archiveKey?: string }).archiveKey, undefined);
  assert.equal(result.fileId, "file-1");
  assert.equal(result.uploadStatus, "ARCHIVED");
});

test("uploads without a digest omit the optional header", async () => {
  const { client, calls } = makeHarness({ payload: { ...UPLOAD_PAYLOAD, uploadStatus: "UPLOADING", sha256: undefined, archiveKey: undefined, archivedAt: undefined } });
  await client.uploadFileContent("session-1", "file-1", {
    body: new ReadableStream<Uint8Array>(),
    byteLength: 12
  });
  assert.deepEqual(headerNames(calls[0] as RecordedCall), ["content-length"]);
});

test("uploads beyond the contract byte limit never reach the network", async () => {
  const { client, calls } = makeHarness({ payload: UPLOAD_PAYLOAD });
  await assert.rejects(
    () =>
      client.uploadFileContent("session-1", "file-1", {
        body: new ReadableStream<Uint8Array>(),
        byteLength: ASSET_MANIFEST_LIMITS.maxFileBytes + 1
      }),
    (error: unknown) => {
      assert.ok(error instanceof BeadImportApiError);
      assert.equal(error.code, "CLIENT_VALIDATION");
      assert.equal(error.retryable, false);
      return true;
    }
  );
  for (const byteLength of [0, -1, 1.5]) {
    await assert.rejects(
      () =>
        client.uploadFileContent("session-1", "file-1", {
          body: new ReadableStream<Uint8Array>(),
          byteLength
        }),
      BeadImportApiError
    );
  }
  await assert.rejects(
    () =>
      client.uploadFileContent("session-1", "file-1", {
        body: new ReadableStream<Uint8Array>(),
        byteLength: 12,
        sha256: "not-a-digest"
      }),
    BeadImportApiError
  );
  assert.deepEqual(calls, []);
});

test("manifest registration validates relative paths before anything is sent", async () => {
  const { client, calls } = makeHarness({
    payload: {
      sessionId: "session-1",
      registeredFileCount: 1,
      files: [
        {
          fileId: "file-1",
          clientFileId: "client-1",
          uploadStatus: "PENDING",
          createdAt: "2026-09-06T08:00:00.000Z"
        }
      ]
    }
  });
  await client.registerManifest("session-1", {
    idempotencyKey: newIdempotencyKey(),
    files: [
      {
        clientFileId: "client-1",
        relativePath: "batch-01/bead-01.jpg",
        byteSize: 2048,
        lastModifiedMs: 1_700_000_000_000,
        kind: "JPEG"
      }
    ]
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.url, "/admin/bead-import/proxy/sessions/session-1/manifest");
  assert.deepEqual(headerNames(calls[0] as RecordedCall), ["content-type"]);

  for (const relativePath of ["/Users/operator/photos/bead.jpg", "C:/photos/bead.jpg", "batch/../escape.jpg", "~/bead.jpg"]) {
    const blocked = makeHarness({ payload: {} });
    await assert.rejects(
      () =>
        blocked.client.registerManifest("session-1", {
          idempotencyKey: newIdempotencyKey(),
          files: [
            {
              clientFileId: "client-1",
              relativePath,
              byteSize: 2048,
              lastModifiedMs: 1_700_000_000_000,
              kind: "JPEG"
            }
          ]
        }),
      (error: unknown) => {
        assert.ok(error instanceof BeadImportApiError);
        assert.equal(error.code, "CLIENT_VALIDATION");
        assert.ok(!error.message.includes(relativePath), "the rejected path must not be echoed");
        assert.ok(
          error.fieldErrors.every((field) => !field.message.includes(relativePath)),
          "field errors must not echo the rejected path"
        );
        return true;
      }
    );
    assert.deepEqual(blocked.calls, []);
  }

  const mismatch = makeHarness({ payload: {} });
  await assert.rejects(
    () =>
      mismatch.client.registerManifest("session-1", {
        idempotencyKey: newIdempotencyKey(),
        files: [
          {
            clientFileId: "client-1",
            relativePath: "batch-01/bead-01.jpg",
            byteSize: 2048,
            lastModifiedMs: 1_700_000_000_000,
            kind: "ARW"
          }
        ]
      }),
    BeadImportApiError
  );
  assert.deepEqual(mismatch.calls, []);
});

test("mutations carry a contract shaped json body and an idempotency key", async () => {
  const { client, calls } = makeHarness({
    payload: { sessionId: "session-2", state: "CREATED", createdAt: "2026-09-06T08:00:00.000Z" }
  });
  const key = newIdempotencyKey();
  const created = await client.createSession(key);
  assert.equal(created.sessionId, "session-2");
  assert.equal(calls[0]?.url, "/admin/bead-import/proxy/sessions");
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.body, JSON.stringify({ idempotencyKey: key }));
  assert.deepEqual(headerNames(calls[0] as RecordedCall), ["content-type"]);
  assert.notEqual(newIdempotencyKey(), newIdempotencyKey());

  const grouping = makeHarness({
    payload: {
      sessionId: "session-1",
      state: "PROCESSING",
      queuedJobCount: 3,
      startedAt: "2026-09-06T08:10:00.000Z"
    }
  });
  await grouping.client.startGrouping("session-1", newIdempotencyKey());
  assert.equal(grouping.calls[0]?.url, "/admin/bead-import/proxy/sessions/session-1/grouping/start");

  const processing = makeHarness({
    payload: {
      sessionId: "session-1",
      state: "PROCESSING",
      queuedJobCount: 1,
      startedAt: "2026-09-06T08:20:00.000Z"
    }
  });
  await processing.client.startProcessing("session-1", newIdempotencyKey());
  assert.equal(processing.calls[0]?.url, "/admin/bead-import/proxy/sessions/session-1/processing/start");
});

test("group updates go through PATCH and adopt the returned revision", async () => {
  const { client, calls } = makeHarness({
    payload: {
      groupId: "group-1",
      state: "NAMED",
      revision: 2,
      memberFileIds: ["file-1"],
      crystalName: "白水晶"
    }
  });
  const result = await client.updateGroup("group-1", {
    action: "SET_NAME",
    expectedGroupRevision: 1,
    crystalName: "白水晶"
  });
  assert.equal(result.revision, 2);
  assert.equal(calls[0]?.method, "PATCH");
  assert.equal(calls[0]?.url, "/admin/bead-import/proxy/groups/group-1");
  assert.equal(
    calls[0]?.body,
    JSON.stringify({ action: "SET_NAME", expectedGroupRevision: 1, crystalName: "白水晶" })
  );
});

test("publish refuses a client invented texture asset key", async () => {
  const { client, calls } = makeHarness({ payload: {} });
  const base = {
    idempotencyKey: newIdempotencyKey(),
    expectedGroupRevision: 4,
    crystalDraftId: "draft-1",
    crystalDraftPromotionConfirmed: true as const,
    crystalName: "白水晶",
    crystalNameConfirmedByOperator: true as const,
    displayName: "白水晶 8mm 圆珠",
    sku: "MXC-WHITE-8",
    materialKey: "quartz-white",
    shape: "ROUND" as const,
    diameterMm: 8,
    qualityStatement: "天然白水晶，肉眼可见细微内含物。",
    qualitySource: "operator-inspection",
    currency: "CNY" as const,
    unitPriceMinor: 3800,
    costMinor: 1200,
    availableQuantity: 12,
    allowPublicDisplay: true as const,
    allowCommercialUse: true as const,
    allowAiRecommendation: false,
    allowAiTraining: false,
    rightsHolder: "玄矶水晶工作室",
    usagePermission: "OWNED" as const,
    isAuthenticPhotograph: true
  };
  await assert.rejects(
    () => client.publishGroup("group-1", { ...base, textureAssetKey: "asset-archive/session-1/file-1.jpg" }),
    BeadImportApiError
  );
  await assert.rejects(
    () => client.publishGroup("group-1", { ...base, textureAssetKey: `approved:${"A".repeat(64)}` }),
    BeadImportApiError
  );
  await assert.rejects(
    () => client.publishGroup("group-1", { ...base } as unknown as PublishBeadImageGroupRequest),
    BeadImportApiError
  );
  assert.deepEqual(calls, [], "a rejected publish must not reach the network");

  const ok = makeHarness({
    payload: {
      groupId: "group-1",
      state: "PUBLISHED",
      materialProductId: "product-1",
      crystalId: "crystal-1",
      inventorySnapshotId: "snapshot-1",
      publishedAt: "2026-09-06T09:00:00.000Z",
      publishedAssetKeys: [`approved:${"a".repeat(64)}`]
    }
  });
  const published = await ok.client.publishGroup("group-1", {
    ...base,
    textureAssetKey: `approved:${"a".repeat(64)}`
  });
  assert.equal(published.materialProductId, "product-1");
  assert.equal(ok.calls[0]?.url, "/admin/bead-import/proxy/groups/group-1/publish");
});

test("human review approvals must carry all seven permission fields", async () => {
  const { client, calls } = makeHarness({ payload: {} });
  const base = {
    idempotencyKey: newIdempotencyKey(),
    expectedGroupRevision: 2,
    processedAssetId: "processed-1",
    reviewNote: "操作者已逐项确认授权信息。"
  };
  await assert.rejects(
    () =>
      client.reviewProcessedAsset("group-1", "processed-1", {
        ...base,
        action: "APPROVE"
      } as unknown as ReviewProcessedAssetRequest),
    BeadImportApiError
  );
  assert.deepEqual(calls, []);

  const APPROVED_KEY = `approved:${"a".repeat(64)}`;
  const ok = makeHarness({
    payload: {
      groupId: "group-1",
      processedAssetId: "processed-1",
      reviewAction: "APPROVE",
      state: "APPROVED",
      revision: 3,
      approvedAssetKey: APPROVED_KEY,
      reviewedAt: "2026-09-06T09:00:00.000Z"
    }
  });
  const approved = await ok.client.reviewProcessedAsset("group-1", "processed-1", {
    ...base,
    action: "APPROVE",
    rightsHolder: "玄矶水晶工作室",
    usagePermission: "OWNED",
    isAuthenticPhotograph: true,
    allowAiTraining: false,
    allowCommercialUse: true,
    allowPublicDisplay: true,
    allowAiRecommendation: false
  });
  assert.equal(
    ok.calls[0]?.url,
    "/admin/bead-import/proxy/groups/group-1/processed-assets/processed-1/review"
  );
  assert.equal(
    approved.approvedAssetKey,
    APPROVED_KEY,
    "the authoritative approved key is the one the Backend returned, not a derived value"
  );

  const rejected = makeHarness({
    payload: {
      groupId: "group-1",
      processedAssetId: "processed-1",
      reviewAction: "REJECT",
      state: "RETIRED",
      revision: 3,
      approvedAssetKey: null,
      reviewedAt: "2026-09-06T09:05:00.000Z"
    }
  });
  const result = await rejected.client.reviewProcessedAsset("group-1", "processed-1", {
    ...base,
    action: "REJECT"
  });
  assert.equal(result.state, "RETIRED");
  // A rejection cannot smuggle permission grants.
  await assert.rejects(
    () =>
      rejected.client.reviewProcessedAsset("group-1", "processed-1", {
        ...base,
        action: "REJECT",
        usagePermission: "OWNED"
      } as unknown as ReviewProcessedAssetRequest),
    BeadImportApiError
  );
});

test("draft completeness and publish results are read with GET", async () => {
  const completeness = makeHarness({
    payload: {
      groupId: "group-1",
      state: "NAMED",
      complete: false,
      missingFields: ["SKU", "TEXTURE_ASSET_KEY"],
      checkedAt: "2026-09-06T09:00:00.000Z"
    }
  });
  const checked = await completeness.client.getDraftCompleteness("group-1");
  assert.deepEqual(checked.missingFields, ["SKU", "TEXTURE_ASSET_KEY"]);
  assert.equal(completeness.calls[0]?.url, "/admin/bead-import/proxy/groups/group-1/draft-completeness");
  assert.equal(completeness.calls[0]?.method, "GET");

  const publishResult = makeHarness({
    payload: {
      groupId: "group-1",
      state: "PUBLISHED",
      materialProductId: "product-1",
      crystalId: "crystal-1",
      inventorySnapshotId: "snapshot-1",
      publishedAt: "2026-09-06T09:00:00.000Z",
      publishedAssetKeys: [`approved:${"a".repeat(64)}`]
    }
  });
  await publishResult.client.getPublishResult("group-1");
  assert.equal(publishResult.calls[0]?.url, "/admin/bead-import/proxy/groups/group-1/publish-result");
});

test("a business error envelope keeps its catalog retryability and recovery action", async () => {
  const { client } = makeHarness({
    status: 422,
    payload: {
      error: {
        code: "UNPROCESSABLE_ENTITY",
        message: "Draft is incomplete.",
        requestId: "req-1",
        assetCode: "DRAFT_INCOMPLETE",
        retryable: false,
        recoveryAction: "COMPLETE_DRAFT_FIELDS",
        fieldErrors: [{ fieldPath: "sku", message: "SKU is required" }]
      }
    }
  });
  await assert.rejects(() => client.getDraftCompleteness("group-1"), (error: unknown) => {
    assert.ok(error instanceof BeadImportApiError);
    assert.equal(error.status, 422);
    assert.equal(error.code, "UNPROCESSABLE_ENTITY");
    assert.equal(error.assetCode, "DRAFT_INCOMPLETE");
    assert.equal(error.recoveryAction, "COMPLETE_DRAFT_FIELDS");
    assert.equal(error.retryable, false);
    assert.deepEqual(error.fieldErrors, [{ fieldPath: "sku", message: "SKU is required" }]);
    return true;
  });
});

test("a server message that names where the Backend runs is replaced by safe copy", async () => {
  for (const message of [
    "upstream http://127.0.0.1:4000 refused the draft",
    "cannot reach localhost:4000 while saving the group",
    "backend at https://bead-import.internal.svc rejected the request",
    "dial tcp 10.24.0.7:5432 timed out",
    "postgres://writer:secret@db.internal:5432/mystcrag is unreachable",
    "no such file under /var/lib/mystcrag/archive"
  ]) {
    const { client } = makeHarness({
      status: 422,
      payload: {
        error: {
          code: "UNPROCESSABLE_ENTITY",
          message,
          requestId: "req-9",
          assetCode: "DRAFT_INCOMPLETE",
          retryable: false,
          recoveryAction: "COMPLETE_DRAFT_FIELDS",
          fieldErrors: [{ fieldPath: "sku", message }]
        }
      }
    });

    await assert.rejects(() => client.getDraftCompleteness("group-1"), (error: unknown) => {
      assert.ok(error instanceof BeadImportApiError);
      assert.equal(error.code, "UNPROCESSABLE_ENTITY");
      for (const copy of [error.message, ...error.fieldErrors.map((field) => field.message)]) {
        assert.notEqual(copy, message, "an unsafe message is replaced, not edited");
        assert.ok(copy.length >= 6, "the operator still gets a real sentence");
        for (const leak of [
          "://",
          "127.0.0.1",
          "localhost",
          "internal.svc",
          "10.24.0.7",
          "db.internal",
          ":4000",
          ":5432",
          "/var/lib",
          "secret"
        ]) {
          assert.equal(copy.includes(leak), false, `operator copy must not name ${leak}`);
        }
      }
      return true;
    });
  }
});

test("a conflict envelope is reported as retryable with the server message", async () => {
  const { client } = makeHarness({
    status: 409,
    payload: {
      error: {
        code: "CONFLICT",
        message: "Bead image group group-1 revision was moved by another operator.",
        requestId: "req-2"
      }
    }
  });
  await assert.rejects(
    () => client.updateGroup("group-1", { action: "SET_NAME", expectedGroupRevision: 1, crystalName: "白水晶" }),
    (error: unknown) => {
      assert.ok(error instanceof BeadImportApiError);
      assert.equal(error.code, "CONFLICT");
      assert.equal(error.status, 409);
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("unparseable or unexpected error bodies fall back to safe copy", async () => {
  const html = makeHarness({
    status: 502,
    rawBody: "<html>upstream connect error to http://127.0.0.1:4000</html>",
    contentType: "text/html"
  });
  await assert.rejects(() => html.client.getSession("session-1"), (error: unknown) => {
    assert.ok(error instanceof BeadImportApiError);
    assert.equal(error.status, 502);
    assert.equal(error.code, "UNEXPECTED_RESPONSE");
    assert.equal(error.retryable, false);
    assert.ok(!error.message.includes("127.0.0.1"));
    assert.ok(!error.message.includes("html"));
    return true;
  });

  const malformed = makeHarness({ status: 400, payload: { error: { code: "TEAPOT", message: "x" } } });
  await assert.rejects(() => malformed.client.getSession("session-1"), (error: unknown) => {
    assert.ok(error instanceof BeadImportApiError);
    assert.equal(error.code, "UNEXPECTED_RESPONSE");
    assert.equal(error.status, 400);
    assert.ok(!error.message.includes("TEAPOT"));
    return true;
  });
});

test("a transport failure is classified without echoing the thrown detail", async () => {
  const { client } = makeHarness({
    throws: new TypeError("fetch failed: connect ECONNREFUSED http://127.0.0.1:4000/api/admin/bead-import/sessions")
  });
  await assert.rejects(() => client.getSession("session-1"), (error: unknown) => {
    assert.ok(error instanceof BeadImportApiError);
    assert.equal(error.code, "NETWORK_ERROR");
    assert.equal(error.retryable, true);
    assert.ok(!error.message.includes("127.0.0.1"));
    assert.ok(!error.message.includes("ECONNREFUSED"));
    assert.ok(!error.message.includes("http"));
    return true;
  });
});

test("an expired admin session is surfaced as a non retryable authorization failure", async () => {
  const { client } = makeHarness({
    status: 401,
    payload: {
      error: { code: "UNAUTHORIZED", message: "Admin session is required.", requestId: "req-3" }
    }
  });
  await assert.rejects(() => client.getSession("session-1"), (error: unknown) => {
    assert.ok(error instanceof BeadImportApiError);
    assert.equal(error.code, "UNAUTHORIZED");
    assert.equal(error.retryable, false);
    assert.equal(error.status, 401);
    return true;
  });
});

function binaryHarness(respond: (url: string) => Response) {
  const calls: RecordedCall[] = [];
  const client = createBeadImportClient({
    fetcher: async (url, init) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers,
        body: init?.body,
        signal: init?.signal ?? undefined
      });
      return respond(url);
    }
  });
  return { client, calls };
}

test("the crystal search goes through the cookie-scoped proxy and parses the contract", async () => {
  const { client, calls } = makeHarness({
    payload: {
      crystals: [
        { crystalId: "crystal-1", nameCn: "紫水晶", nameEn: "Amethyst", mineralName: "石英" }
      ],
      nextCursor: null
    }
  });
  const page = await client.listCrystals({ q: "紫水晶", limit: 10 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "GET");
  assert.equal(calls[0]?.url, `${BEAD_IMPORT_BROWSER_PROXY_PREFIX}/crystals?q=${encodeURIComponent("紫水晶")}&limit=10`);
  assert.equal(headerNames(calls[0] ?? { headers: {} }).includes("x-admin-key"), false);
  assert.deepEqual(page.crystals[0], {
    crystalId: "crystal-1",
    nameCn: "紫水晶",
    nameEn: "Amethyst",
    mineralName: "石英"
  });
  assert.equal(page.nextCursor, null);
});

test("the crystal search validates the query before any request is made", async () => {
  const { client, calls } = makeHarness({});
  await assert.rejects(() => client.listCrystals({ q: "   " }), (error: unknown) => {
    assert.ok(error instanceof BeadImportApiError);
    assert.equal(error.code, "CLIENT_VALIDATION");
    return true;
  });
  assert.deepEqual(calls, [], "an empty query must not reach the network");
});

test("a source file preview is read through the proxy as a blob without the admin key", async () => {
  const { client, calls } = binaryHarness(
    () =>
      new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), {
        status: 200,
        headers: { "content-type": "image/jpeg", etag: '"abc123"', "cache-control": "private, no-store" }
      })
  );
  const content = await client.readSourceFileContent("file-1");

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "GET");
  assert.equal(calls[0]?.url, `${BEAD_IMPORT_BROWSER_PROXY_PREFIX}/files/file-1/content`);
  assert.equal(headerNames(calls[0] ?? { headers: {} }).includes("x-admin-key"), false);
  assert.equal(content.contentType, "image/jpeg");
  assert.equal(content.etag, '"abc123"');
  assert.equal(content.byteSize, 3);
  assert.equal(await content.blob.arrayBuffer().then((buffer) => buffer.byteLength), 3);
});

test("a processed rendition read forwards the rendition query", async () => {
  const { client, calls } = binaryHarness(
    () =>
      new Response(new Blob([new Uint8Array([9])], { type: "image/webp" }), {
        status: 200,
        headers: { "content-type": "image/webp", etag: '"xyz789"' }
      })
  );
  const content = await client.readProcessedAssetContent("processed-1", "thumbnail");

  assert.equal(calls[0]?.url, `${BEAD_IMPORT_BROWSER_PROXY_PREFIX}/processed-assets/processed-1/content?rendition=thumbnail`);
  assert.equal(content.contentType, "image/webp");
});

test("an ARW source that the Backend refuses maps to a typed preview failure", async () => {
  const { client } = binaryHarness(
    () =>
      new Response(
        JSON.stringify({
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "This file kind cannot be previewed.",
            assetCode: "SOURCE_PREVIEW_UNAVAILABLE",
            retryable: false,
            recoveryAction: "NO_RECOVERY",
            requestId: "req-1"
          }
        }),
        { status: 415, headers: { "content-type": "application/json" } }
      )
  );

  await assert.rejects(() => client.readSourceFileContent("file-arw"), (error: unknown) => {
    assert.ok(error instanceof BeadImportApiError);
    assert.equal(error.status, 415);
    assert.equal(error.assetCode, "SOURCE_PREVIEW_UNAVAILABLE");
    assert.equal(error.retryable, false);
    return true;
  });
});
