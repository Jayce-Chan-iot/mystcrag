import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSET_ADMIN_CONSOLE_HOME,
  runAssetAdminLogin,
  runAssetAdminLogout
} from "./login-flow";
import {
  ASSET_ADMIN_COOKIE_NAME,
  assetAdminSessionToken,
  verifyAssetAdminKey,
  verifyAssetAdminLocalCredentials
} from "./admin-auth";

const VALID_KEY = "asset-admin-key-0123456789abcdef";
const ENV = { MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY, NODE_ENV: "production" };

type Recording = {
  targets: string[];
  created: number;
  destroyed: number;
  verified: string[];
  verifiedCredentials: Array<{ username: string; password: string }>;
};

function makeDeps(overrides: { configured?: boolean; env?: Record<string, string>; mode?: "ADMIN_KEY" | "LOCAL_CREDENTIALS" } = {}) {
  const env = overrides.env ?? ENV;
  const configured = overrides.configured ?? true;
  const recording: Recording = { targets: [], created: 0, destroyed: 0, verified: [], verifiedCredentials: [] };
  const store = new Map<string, string>();
  const deps = {
    configured,
    mode: overrides.mode ?? "ADMIN_KEY",
    verifyKey: (candidate: string) => {
      recording.verified.push(candidate);
      return verifyAssetAdminKey(candidate, env);
    },
    verifyLocalCredentials: (username: string, password: string) => {
      recording.verifiedCredentials.push({ username, password });
      return verifyAssetAdminLocalCredentials(username, password, env);
    },
    createSession: () => {
      recording.created += 1;
      const token = assetAdminSessionToken(env);
      assert.ok(token !== null);
      store.set(ASSET_ADMIN_COOKIE_NAME, token);
    },
    destroySession: () => {
      recording.destroyed += 1;
      store.delete(ASSET_ADMIN_COOKIE_NAME);
    },
    redirect: (target: string) => {
      recording.targets.push(target);
      throw new Error(`redirect:${target}`);
    }
  };
  return { deps, recording, store };
}

function credentialsForm(username: string, password: string): FormData {
  const formData = new FormData();
  formData.set("username", username);
  formData.set("password", password);
  return formData;
}

function formWith(value: unknown): FormData {
  const formData = new FormData();
  if (typeof value === "string") {
    formData.set("key", value);
  }
  return formData;
}

test("a correct key mints exactly one session and lands on the console home", () => {
  const { deps, recording, store } = makeDeps();
  assert.throws(() => runAssetAdminLogin(formWith(VALID_KEY), deps), /redirect:\/admin\/bead-import$/);
  assert.deepEqual(recording.targets, [ASSET_ADMIN_CONSOLE_HOME]);
  assert.equal(ASSET_ADMIN_CONSOLE_HOME, "/admin/bead-import");
  assert.equal(recording.created, 1);
  assert.equal(recording.destroyed, 0);
  assert.equal(store.get(ASSET_ADMIN_COOKIE_NAME), assetAdminSessionToken(ENV));
});

test("development local admin credentials mint a session without exposing or submitting the strong key", () => {
  const env = {
    NODE_ENV: "development",
    MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY,
    MYSTCRAG_ASSET_ADMIN_LOCAL_USERNAME: "admin",
    MYSTCRAG_ASSET_ADMIN_LOCAL_PASSWORD: "admin"
  };
  const { deps, recording, store } = makeDeps({ env, mode: "LOCAL_CREDENTIALS" });
  assert.throws(() => runAssetAdminLogin(credentialsForm("admin", "admin"), deps), /redirect:\/admin\/bead-import$/);
  assert.equal(recording.created, 1);
  assert.deepEqual(recording.verified, []);
  assert.deepEqual(recording.verifiedCredentials, [{ username: "admin", password: "admin" }]);
  assert.equal(store.get(ASSET_ADMIN_COOKIE_NAME), assetAdminSessionToken(env));
});

test("wrong local credentials are rejected without minting a session", () => {
  const env = {
    NODE_ENV: "development",
    MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY,
    MYSTCRAG_ASSET_ADMIN_LOCAL_USERNAME: "admin",
    MYSTCRAG_ASSET_ADMIN_LOCAL_PASSWORD: "admin"
  };
  const { deps, recording } = makeDeps({ env, mode: "LOCAL_CREDENTIALS" });
  assert.throws(() => runAssetAdminLogin(credentialsForm("admin", "wrong"), deps));
  assert.deepEqual(recording.targets, ["/admin/bead-import/login?error=invalid"]);
  assert.equal(recording.created, 0);
  assert.deepEqual(recording.verified, []);
});

test("a wrong key never mints a session and reports a generic invalid error", () => {
  const wrongKey = "asset-admin-key-9999999999";
  const { deps, recording, store } = makeDeps();
  assert.throws(() => runAssetAdminLogin(formWith(wrongKey), deps));
  assert.deepEqual(recording.targets, ["/admin/bead-import/login?error=invalid"]);
  assert.equal(recording.created, 0);
  assert.equal(store.size, 0);
  assert.deepEqual(recording.verified, [wrongKey]);
});

test("the submitted key is never echoed back into the redirect target", () => {
  const candidates = ["asset-admin-key-9999999999", "short", VALID_KEY.toUpperCase(), VALID_KEY];
  for (const candidate of candidates) {
    const { deps, recording } = makeDeps();
    assert.throws(() => runAssetAdminLogin(formWith(candidate), deps));
    for (const target of recording.targets) {
      assert.ok(!target.includes(candidate));
      assert.ok(!target.includes(encodeURIComponent(candidate)));
      assert.match(target, /^\/admin\/bead-import(\/login(\?error=invalid)?)?$/);
    }
  }
});

test("a missing or non-string key is rejected without touching the session", () => {
  for (const value of [undefined, "", "   ", "a".repeat(15)]) {
    const { deps, recording } = makeDeps();
    const formData = new FormData();
    if (typeof value === "string") {
      formData.set("key", value);
    }
    assert.throws(() => runAssetAdminLogin(formData, deps));
    assert.deepEqual(recording.targets, ["/admin/bead-import/login?error=invalid"]);
    assert.equal(recording.created, 0);
  }
});

test("an unconfigured deployment refuses login even with the historically correct key", () => {
  const { deps, recording, store } = makeDeps({ configured: false });
  assert.throws(() => runAssetAdminLogin(formWith(VALID_KEY), deps));
  assert.deepEqual(recording.targets, ["/admin/bead-import/login?error=not-configured"]);
  assert.equal(recording.created, 0);
  assert.deepEqual(recording.verified, []);
  assert.equal(store.size, 0);
});

test("a too-short configured key fails closed at login time", () => {
  const { deps, recording } = makeDeps({ env: { MYSTCRAG_ASSET_ADMIN_KEY: "short", NODE_ENV: "production" } });
  assert.throws(() => runAssetAdminLogin(formWith("short"), deps));
  assert.deepEqual(recording.targets, ["/admin/bead-import/login?error=invalid"]);
  assert.equal(recording.created, 0);
});

test("logout destroys only the bead import session and returns to the login page", () => {
  const { deps, recording, store } = makeDeps();
  store.set(ASSET_ADMIN_COOKIE_NAME, "existing-token");
  store.set("mystcrag_knowledge_admin", "knowledge-token");
  assert.throws(() => runAssetAdminLogout(deps), /redirect:\/admin\/bead-import\/login$/);
  assert.deepEqual(recording.targets, ["/admin/bead-import/login"]);
  assert.equal(recording.destroyed, 1);
  assert.equal(recording.created, 0);
  assert.equal(store.has(ASSET_ADMIN_COOKIE_NAME), false);
  assert.equal(store.get("mystcrag_knowledge_admin"), "knowledge-token");
});

test("logout on an unconfigured deployment still clears the cookie and redirects", () => {
  const { deps, recording } = makeDeps({ configured: false });
  assert.throws(() => runAssetAdminLogout(deps));
  assert.deepEqual(recording.targets, ["/admin/bead-import/login"]);
  assert.equal(recording.destroyed, 1);
});
