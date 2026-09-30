import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { CreateOracleSessionRequest } from "@mystcrag/design-contract";

import {
  createOracleSetupClientSubmitter,
  type OracleSetupClientSubmitter
} from "../../../app/oracle/oracle-setup-client";
import type { OracleSetupInput } from "./components/oracle-setup";
import { createOracleQuestionStore } from "./oracle-question-provider";

type CreateSession = (
  request: CreateOracleSessionRequest
) => Promise<{ session: { sessionId: string } }>;

const input: OracleSetupInput = {
  question: "两次激活只应创建一次",
  wristCircumferenceMm: 155
};

function createClientHarness(createSession?: CreateSession) {
  const calls: CreateOracleSessionRequest[] = [];
  const navigations: string[] = [];
  let operationCounter = 0;
  const pending: Array<{
    resolve: (value: { session: { sessionId: string } }) => void;
    reject: (error: unknown) => void;
  }> = [];

  const create: CreateSession = (request) => {
    calls.push(request);
    if (createSession) return createSession(request);
    return new Promise<{ session: { sessionId: string } }>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  };

  const submit: OracleSetupClientSubmitter = createOracleSetupClientSubmitter({
    questionStore: createOracleQuestionStore(),
    navigate: (path) => navigations.push(path),
    createSession: create,
    nextOperationId: (kind) => `oracle-${kind}-${(operationCounter += 1)}`
  });

  return {
    calls,
    navigations,
    submit,
    generatedIds: () => operationCounter,
    finish(sessionId = "oracle-session-1") {
      for (const entry of pending.splice(0)) entry.resolve({ session: { sessionId } });
    },
    fail(error: unknown) {
      for (const entry of pending.splice(0)) entry.reject(error);
    }
  };
}

test("two simultaneous activations through the setup client create one session and navigate once", { timeout: 10_000 }, async () => {
  const harness = createClientHarness();

  const first = harness.submit(input);
  const second = harness.submit(input);
  harness.finish("oracle-session-1");
  await Promise.all([first, second]);

  assert.equal(harness.calls.length, 1, "the client must issue exactly one create");
  assert.deepEqual(harness.navigations, ["/oracle/result/oracle-session-1"]);
  assert.equal(
    harness.generatedIds(),
    2,
    "an in-flight activation must not generate a second requestId/operationId pair"
  );
});

test("activations about 30 ms apart still create one session and navigate once", { timeout: 10_000 }, async () => {
  const harness = createClientHarness();

  const first = harness.submit(input);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = harness.submit(input);
  harness.finish("oracle-session-1");
  await Promise.all([first, second]);

  assert.equal(
    harness.calls.length,
    1,
    "the ~30 ms double activation must not reach the network twice"
  );
  assert.deepEqual(harness.navigations, ["/oracle/result/oracle-session-1"]);
  assert.equal(harness.generatedIds(), 2);
});

test("a second activation after the create settled but before navigation commits creates exactly one session", { timeout: 10_000 }, async () => {
  const harness = createClientHarness(async () => ({ session: { sessionId: "oracle-session-1" } }));

  const first = harness.submit(input);
  await first; // create resolved and navigate() was called synchronously; the /oracle page is still mounted
  const second = harness.submit(input);
  await second;

  assert.equal(
    harness.calls.length,
    1,
    "a post-settle activation must not issue a second create while the route is still committing"
  );
  assert.deepEqual(harness.navigations, ["/oracle/result/oracle-session-1"]);
  assert.equal(
    harness.generatedIds(),
    2,
    "the second activation must not generate a second requestId/operationId pair"
  );
});

test("a failed activation releases the guard so the user can retry successfully", { timeout: 10_000 }, async () => {
  const calls: CreateOracleSessionRequest[] = [];
  const navigations: string[] = [];
  let attempt = 0;
  let operationCounter = 0;

  const submit = createOracleSetupClientSubmitter({
    questionStore: createOracleQuestionStore(),
    navigate: (path) => navigations.push(path),
    nextOperationId: (kind) => `oracle-${kind}-${(operationCounter += 1)}`,
    createSession: async (request) => {
      calls.push(request);
      attempt += 1;
      if (attempt === 1) throw new Error("network down");
      return { session: { sessionId: "oracle-session-retry" } };
    }
  });

  await assert.rejects(() => submit(input), /network down/);
  await submit(input);

  assert.equal(calls.length, 2, "a settled failure must free the guard for a retry");
  assert.deepEqual(navigations, ["/oracle/result/oracle-session-retry"]);
});

test("the setup client builds one shared submitter instead of one per activation", () => {
  const source = readFileSync(
    new URL("../../../app/oracle/oracle-setup-client.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /export function createOracleSetupClientSubmitter/);
  assert.match(
    source,
    /useState<OracleSetupClientSubmitter>\(\(\)\s*=>/,
    "the component must hold one submitter instance across renders"
  );

  const handlerStart = source.indexOf("onSubmit={() => {");
  const handlerEnd = source.indexOf("onWristChange=");
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.doesNotMatch(
    source.slice(handlerStart, handlerEnd),
    /createOracleSetupClientSubmitter\(/,
    "the submit handler must not rebuild the submitter on every activation"
  );
});

test("the setup client holds the submitting state through navigation instead of clearing it on success", () => {
  const source = readFileSync(
    new URL("../../../app/oracle/oracle-setup-client.tsx", import.meta.url),
    "utf8"
  );

  const handlerStart = source.indexOf("onSubmit={() => {");
  const handlerEnd = source.indexOf("onWristChange=");
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  assert.doesNotMatch(
    handler,
    /\.finally\(/,
    "the submit handler must not clear isSubmitting in a success finally"
  );
  assert.equal(
    (handler.match(/setIsSubmitting\(false\)/g) ?? []).length,
    1,
    "isSubmitting(false) must appear exactly once, on the failure path"
  );
  const catchIndex = handler.indexOf(".catch(");
  const resetIndex = handler.indexOf("setIsSubmitting(false)");
  assert.ok(
    catchIndex >= 0 && resetIndex > catchIndex,
    "isSubmitting must only be released on rejection, never on the successful settle"
  );
});