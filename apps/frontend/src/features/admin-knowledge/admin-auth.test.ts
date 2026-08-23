import assert from "node:assert/strict";
import test from "node:test";

import {
  isConsoleConfigured,
  resolveKnowledgeAdminKey,
  verifyAdminKey
} from "./admin-auth";

const VALID_KEY = "console-admin-key-0123456789abcdef";

test("resolveKnowledgeAdminKey accepts MYSTCRAG_KNOWLEDGE_ADMIN_KEY first", () => {
  const env = {
    MYSTCRAG_KNOWLEDGE_ADMIN_KEY: VALID_KEY,
    KNOWLEDGE_ADMIN_API_KEY: "another-admin-key-0123456789"
  };
  assert.equal(resolveKnowledgeAdminKey(env), VALID_KEY);
});

test("resolveKnowledgeAdminKey falls back to KNOWLEDGE_ADMIN_API_KEY", () => {
  const env = { KNOWLEDGE_ADMIN_API_KEY: VALID_KEY };
  assert.equal(resolveKnowledgeAdminKey(env), VALID_KEY);
});

test("resolveKnowledgeAdminKey rejects missing and too-short keys (fail closed)", () => {
  assert.equal(resolveKnowledgeAdminKey({}), null);
  assert.equal(resolveKnowledgeAdminKey({ MYSTCRAG_KNOWLEDGE_ADMIN_KEY: "short-key" }), null);
  assert.equal(resolveKnowledgeAdminKey({ MYSTCRAG_KNOWLEDGE_ADMIN_KEY: "" }), null);
});

test("isConsoleConfigured mirrors key resolution", () => {
  assert.equal(isConsoleConfigured({ KNOWLEDGE_ADMIN_API_KEY: VALID_KEY }), true);
  assert.equal(isConsoleConfigured({ KNOWLEDGE_ADMIN_API_KEY: "short" }), false);
  assert.equal(isConsoleConfigured({}), false);
});

test("verifyAdminKey accepts the configured key and rejects everything else", () => {
  const env = { MYSTCRAG_KNOWLEDGE_ADMIN_KEY: VALID_KEY };
  assert.equal(verifyAdminKey(VALID_KEY, env), true);
  assert.equal(verifyAdminKey(`${VALID_KEY}x`, env), false);
  assert.equal(verifyAdminKey("", env), false);
  assert.equal(verifyAdminKey(VALID_KEY.toUpperCase(), env), false);
});

test("verifyAdminKey fails closed when the console is not configured", () => {
  assert.equal(verifyAdminKey(VALID_KEY, {}), false);
  assert.equal(verifyAdminKey(VALID_KEY, { MYSTCRAG_KNOWLEDGE_ADMIN_KEY: "short" }), false);
});
