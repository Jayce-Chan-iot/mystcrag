import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AssetPreview, mountAssetPreviewEffect, type ViewState } from "./asset-preview";
import type { PreviewLoaderClient } from "../preview-loader";

const SOURCE = readFileSync(join(__dirname, "asset-preview.tsx"), "utf8");

type BinaryContent = {
  blob: Blob;
  contentType: string | null;
  etag: string | null;
  byteSize: number;
};

type DeferredContent = {
  promise: Promise<BinaryContent>;
  resolve: (content?: BinaryContent) => void;
  reject: (error: unknown) => void;
};

function makeDeferred(kind: string): DeferredContent {
  let inner!: (value: BinaryContent) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<BinaryContent>((res, rej) => {
    inner = res;
    fail = rej;
  });
  return {
    promise,
    resolve: (content) =>
      inner(content ?? { blob: new Blob([kind]), contentType: `image/${kind}`, etag: null, byteSize: 1 }),
    reject: fail
  };
}

function makeHarness() {
  const created: string[] = [];
  const revoked: string[] = [];
  const abortReasons: unknown[] = [];
  const gates = new Map<string, DeferredContent>();
  let nextUrl = 0;

  // A gate serves exactly one read (pop semantics): a retried read falls
  // through to immediate success, modelling a transient failure.
  const client: PreviewLoaderClient = {
    readSourceFileContent: async (fileId) => {
      const gate = gates.get(fileId);
      gates.delete(fileId);
      return gate === undefined
        ? { blob: new Blob([fileId]), contentType: "image/jpeg", etag: null, byteSize: 1 }
        : await gate.promise;
    },
    readProcessedAssetContent: async (processedAssetId, rendition) => {
      const key = `${processedAssetId}:${rendition}`;
      const gate = gates.get(key);
      gates.delete(key);
      return gate === undefined
        ? { blob: new Blob([processedAssetId]), contentType: "image/webp", etag: null, byteSize: 1 }
        : await gate.promise;
    }
  };

  const objectUrls = {
    createObjectUrl: (blob: Blob) => {
      nextUrl += 1;
      const url = `blob:${blob.size}-${nextUrl}`;
      created.push(url);
      return url;
    },
    revokeObjectUrl: (url: string) => {
      revoked.push(url);
    }
  };

  const createAbortController = () => {
    const controller = {
      signal: { aborted: false },
      abort: (reason?: unknown) => {
        controller.signal.aborted = true;
        abortReasons.push(reason);
      }
    };
    return controller;
  };

  /** The component's own effect body, driven through React-equivalent lifecycles. */
  function mount(input: {
    kind: "source" | "processed";
    id: string;
    rendition?: "main" | "thumbnail";
    onState?: (view: ViewState) => void;
  }): { dispose(): void; states: ViewState[] } {
    const states: ViewState[] = [];
    const dispose = mountAssetPreviewEffect({
      kind: input.kind,
      id: input.id,
      rendition: input.rendition,
      client,
      objectUrls,
      createAbortController,
      onState: (view) => {
        states.push(view);
        input.onState?.(view);
      }
    });
    return { dispose, states };
  }

  return { mount, created, revoked, abortReasons, gate: (key: string) => {
    const existing = gates.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const gate = makeDeferred(key);
    gates.set(key, gate);
    return gate;
  } };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

test("a failed first load can be retried into a successful preview", async () => {
  const harness = makeHarness();
  const gate = harness.gate("file-1");

  const first = harness.mount({ kind: "source", id: "file-1" });
  gate.reject(new Error("transient"));
  await settle();
  assert.equal(first.states.at(-1)?.status, "ERROR", "the operator sees the failure");

  // The retry button re-runs the effect: a cleanup, then a fresh mount.
  first.dispose();
  const second = harness.mount({ kind: "source", id: "file-1" });
  await settle();

  assert.equal(second.states.at(-1)?.status, "READY", "a retry must be able to succeed");
  assert.notEqual(
    second.states.at(-1)?.status === "READY" ? second.states.at(-1) : null,
    null
  );
  second.dispose();
  assert.deepEqual(harness.revoked, harness.created, "every url is revoked on dispose");
});

test("changing id or rendition loads the new preview and never leaks the old request", async () => {
  const harness = makeHarness();
  const staleGate = harness.gate("file-a");

  const first = harness.mount({ kind: "source", id: "file-a" });
  // Props change: React runs the cleanup, then the effect again for the new id.
  first.dispose();
  const second = harness.mount({ kind: "processed", id: "pa-1", rendition: "thumbnail" });
  await settle();

  assert.equal(second.states.at(-1)?.status, "READY", "the new preview loads after the switch");
  const urlsAfterSwitch = [...harness.created];
  assert.equal(urlsAfterSwitch.length, 1, "exactly the new preview's url is tracked");

  staleGate.resolve(undefined);
  await settle();
  assert.deepEqual(
    harness.created,
    urlsAfterSwitch,
    "the aborted old read never surfaces bytes, even when they arrive later"
  );
  assert.deepEqual(
    harness.revoked.filter((url) => !harness.created.includes(url)),
    [],
    "no live url may be revoked by an old request"
  );

  second.dispose();
  assert.deepEqual(harness.revoked, harness.created);
});

test("a Strict-Mode-style replay (mount, cleanup, mount) never leaks or bricks the preview", async () => {
  const harness = makeHarness();
  const gate = harness.gate("file-slow");

  const first = harness.mount({ kind: "source", id: "file-slow" });
  first.dispose();
  gate.resolve(undefined);
  await settle();
  assert.deepEqual(harness.created, [], "the replayed-out response creates no url");

  const second = harness.mount({ kind: "source", id: "file-slow" });
  await settle();
  assert.equal(
    second.states.at(-1)?.status,
    "READY",
    "the effect after a Strict-Mode cleanup must still work"
  );
  second.dispose();
  assert.deepEqual(harness.revoked, harness.created);
});

test("the component creates its effect lifecycle per run and never shares a loader", () => {
  assert.ok(SOURCE.includes("mountAssetPreviewEffect"), "the effect delegates to the lifecycle factory");
  assert.ok(
    /React\.useEffect\(\(\) =>\s*\{[\s\S]*?mountAssetPreviewEffect\(/.test(SOURCE),
    "a fresh lifecycle is created inside the effect, not in a shared memo"
  );
  assert.ok(
    !SOURCE.includes("useMemo(() => createPreviewLoader"),
    "a memoized shared loader would go terminal on cleanup and brick retries"
  );
  assert.match(
    SOURCE,
    /\}, \[client, objectUrls, kind, id, rendition, attempt\]\)/,
    "the effect re-runs for id, rendition and retry changes"
  );
});

test("the component still renders labels, fallback copy and the retry affordance", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssetPreview, {
      label: "原图",
      kind: "source",
      id: "file-1",
      client: {
        readSourceFileContent: async () => {
          throw new Error("no load during SSR");
        },
        readProcessedAssetContent: async () => {
          throw new Error("no load during SSR");
        }
      },
      objectUrls: {
        createObjectUrl: () => "blob:ssr",
        revokeObjectUrl: () => {}
      }
    })
  );
  assert.ok(html.includes("原图"));
  assert.ok(html.includes("正在加载预览…"));
  assert.ok(!html.includes("blob:ssr"), "no url can exist before any load");
});
