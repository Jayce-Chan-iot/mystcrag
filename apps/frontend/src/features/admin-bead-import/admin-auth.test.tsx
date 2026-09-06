import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  ASSET_ADMIN_COOKIE_NAME,
  ASSET_ADMIN_COOKIE_PATH,
  ASSET_ADMIN_SESSION_MAX_AGE_SECONDS,
  MIN_ASSET_ADMIN_KEY_BYTES,
  assetAdminCookieOptions,
  assetAdminSessionToken,
  createAssetAdminSession,
  destroyAssetAdminSession,
  isAssetAdminAuthenticated,
  isAssetAdminConfigured,
  readAssetAdminSessionToken,
  resolveAssetAdminKey,
  verifyAssetAdminKey,
  type AssetAdminCookieOptions,
  type AssetAdminCookieStore
} from "./admin-auth";
import { requireAssetAdminAccess } from "./page-guard";
import { AdminLoginForm } from "./components/admin-login-form";

const VALID_KEY = "asset-admin-key-0123456789abcdef";
const KNOWLEDGE_COOKIE_NAME = "mystcrag_knowledge_admin";

type RecordedSet = {
  name: string;
  value: string;
  options: AssetAdminCookieOptions;
};

function makeCookieStore(initial: Record<string, string> = {}): {
  store: AssetAdminCookieStore;
  sets: RecordedSet[];
  deletes: string[];
} {
  const jar = new Map(Object.entries(initial));
  const sets: RecordedSet[] = [];
  const deletes: string[] = [];
  return {
    sets,
    deletes,
    store: {
      get(name) {
        const value = jar.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set(name, value, options) {
        sets.push({ name, value, options });
        jar.set(name, value);
      },
      delete(name) {
        deletes.push(name);
        jar.delete(name);
      }
    }
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("resolveAssetAdminKey prefers MYSTCRAG_ASSET_ADMIN_KEY over the fallback", () => {
  const env = {
    MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY,
    ASSET_ADMIN_API_KEY: "fallback-asset-key-0123456789"
  };
  assert.equal(resolveAssetAdminKey(env), VALID_KEY);
});

test("resolveAssetAdminKey falls back to ASSET_ADMIN_API_KEY", () => {
  assert.equal(resolveAssetAdminKey({ ASSET_ADMIN_API_KEY: VALID_KEY }), VALID_KEY);
});

test("resolveAssetAdminKey fails closed when no key is configured", () => {
  assert.equal(resolveAssetAdminKey({}), null);
  assert.equal(resolveAssetAdminKey({ MYSTCRAG_ASSET_ADMIN_KEY: "" }), null);
  assert.equal(resolveAssetAdminKey({ ASSET_ADMIN_API_KEY: "" }), null);
});

test("resolveAssetAdminKey measures at least 16 UTF-8 bytes, not characters", () => {
  assert.equal(MIN_ASSET_ADMIN_KEY_BYTES, 16);
  // 15 ASCII characters = 15 bytes: rejected.
  assert.equal(resolveAssetAdminKey({ MYSTCRAG_ASSET_ADMIN_KEY: "a".repeat(15) }), null);
  // 16 ASCII characters = 16 bytes: accepted.
  assert.equal(resolveAssetAdminKey({ MYSTCRAG_ASSET_ADMIN_KEY: "a".repeat(16) }), "a".repeat(16));
  // 6 CJK characters = 18 bytes: accepted even though it is under 16 characters.
  const cjkKey = "玄".repeat(6);
  assert.equal(Buffer.byteLength(cjkKey, "utf8"), 18);
  assert.equal(resolveAssetAdminKey({ MYSTCRAG_ASSET_ADMIN_KEY: cjkKey }), cjkKey);
  // 5 CJK characters = 15 bytes: rejected.
  assert.equal(resolveAssetAdminKey({ MYSTCRAG_ASSET_ADMIN_KEY: "玄".repeat(5) }), null);
});

test("a too-short preferred key fails closed instead of silently using the fallback", () => {
  const env = { MYSTCRAG_ASSET_ADMIN_KEY: "short-key", ASSET_ADMIN_API_KEY: VALID_KEY };
  assert.equal(resolveAssetAdminKey(env), null);
  assert.equal(isAssetAdminConfigured(env), false);
});

test("isAssetAdminConfigured mirrors key resolution", () => {
  assert.equal(isAssetAdminConfigured({ MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY }), true);
  assert.equal(isAssetAdminConfigured({ ASSET_ADMIN_API_KEY: VALID_KEY }), true);
  assert.equal(isAssetAdminConfigured({ ASSET_ADMIN_API_KEY: "short" }), false);
  assert.equal(isAssetAdminConfigured({}), false);
});

test("verifyAssetAdminKey accepts only the exact configured key", () => {
  const env = { MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY };
  assert.equal(verifyAssetAdminKey(VALID_KEY, env), true);
  assert.equal(verifyAssetAdminKey(`${VALID_KEY}x`, env), false);
  assert.equal(verifyAssetAdminKey(VALID_KEY.slice(0, -1), env), false);
  assert.equal(verifyAssetAdminKey("", env), false);
  assert.equal(verifyAssetAdminKey(VALID_KEY.toUpperCase(), env), false);
});

test("verifyAssetAdminKey fails closed on an unconfigured deployment and on short candidates", () => {
  assert.equal(verifyAssetAdminKey(VALID_KEY, {}), false);
  assert.equal(verifyAssetAdminKey(VALID_KEY, { MYSTCRAG_ASSET_ADMIN_KEY: "short" }), false);
  // A 15-byte candidate can never match, and must not reach a length-mismatched compare.
  assert.equal(verifyAssetAdminKey("a".repeat(15), { MYSTCRAG_ASSET_ADMIN_KEY: "a".repeat(15) }), false);
});

test("the session token is irreversible and never contains the admin key", () => {
  const env = { MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY };
  const token = assetAdminSessionToken(env);
  assert.ok(token !== null);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.ok(!token.includes(VALID_KEY));
  assert.notEqual(token, VALID_KEY);
  assert.notEqual(token, sha256Hex(VALID_KEY));
  assert.equal(assetAdminSessionToken(env), token);
  assert.notEqual(assetAdminSessionToken({ MYSTCRAG_ASSET_ADMIN_KEY: `${VALID_KEY}2` }), token);
  assert.equal(assetAdminSessionToken({}), null);
});

test("the asset session token is domain separated from the knowledge console token", () => {
  const sharedKey = "same-key-for-both-consoles-01";
  const assetToken = assetAdminSessionToken({ MYSTCRAG_ASSET_ADMIN_KEY: sharedKey });
  assert.ok(assetToken !== null);
  assert.notEqual(assetToken, sha256Hex(sharedKey));
});

test("cookie options are httpOnly, strict, path scoped and expire after eight hours", () => {
  assert.equal(ASSET_ADMIN_COOKIE_NAME, "mystcrag_asset_admin");
  assert.equal(ASSET_ADMIN_COOKIE_PATH, "/admin/bead-import");
  assert.equal(ASSET_ADMIN_SESSION_MAX_AGE_SECONDS, 8 * 60 * 60);

  const production = assetAdminCookieOptions({ NODE_ENV: "production" });
  assert.deepEqual(production, {
    httpOnly: true,
    sameSite: "strict",
    secure: true,
    path: "/admin/bead-import",
    maxAge: 28800
  });

  const development = assetAdminCookieOptions({ NODE_ENV: "development" });
  assert.equal(development.secure, false);
  assert.equal(development.httpOnly, true);
  assert.equal(development.sameSite, "strict");
  assert.equal(development.path, "/admin/bead-import");
  assert.equal(development.maxAge, 28800);
});

test("the asset cookie never shares the knowledge console name or path", () => {
  assert.notEqual(ASSET_ADMIN_COOKIE_NAME, KNOWLEDGE_COOKIE_NAME);
  assert.notEqual(ASSET_ADMIN_COOKIE_PATH, "/admin/knowledge");
});

test("createAssetAdminSession stores only the irreversible token with the exact options", () => {
  const env = { MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY, NODE_ENV: "production" };
  const { store, sets } = makeCookieStore();
  createAssetAdminSession(store, env);

  const session = sets[0];
  if (session === undefined) {
    throw new Error("expected createAssetAdminSession to write exactly one cookie");
  }
  assert.equal(sets.length, 1);
  assert.equal(session.name, ASSET_ADMIN_COOKIE_NAME);
  assert.equal(session.value, assetAdminSessionToken(env));
  assert.ok(!session.value.includes(VALID_KEY));
  assert.deepEqual(session.options, assetAdminCookieOptions(env));
});

test("createAssetAdminSession refuses to mint a session on an unconfigured deployment", () => {
  const { store, sets } = makeCookieStore();
  assert.throws(() => createAssetAdminSession(store, {}), /not configured/i);
  assert.throws(() => createAssetAdminSession(store, { MYSTCRAG_ASSET_ADMIN_KEY: "short" }), /not configured/i);
  assert.equal(sets.length, 0);
});

test("isAssetAdminAuthenticated accepts only a token minted from the configured key", () => {
  const env = { MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY };
  const token = assetAdminSessionToken(env);
  assert.ok(token !== null);

  assert.equal(isAssetAdminAuthenticated(makeCookieStore({ [ASSET_ADMIN_COOKIE_NAME]: token }).store, env), true);
  assert.equal(isAssetAdminAuthenticated(makeCookieStore().store, env), false);
  assert.equal(isAssetAdminAuthenticated(makeCookieStore({ [ASSET_ADMIN_COOKIE_NAME]: `${token}0` }).store, env), false);
  assert.equal(isAssetAdminAuthenticated(makeCookieStore({ [ASSET_ADMIN_COOKIE_NAME]: token.slice(0, 63) }).store, env), false);
  assert.equal(isAssetAdminAuthenticated(makeCookieStore({ [ASSET_ADMIN_COOKIE_NAME]: VALID_KEY }).store, env), false);
});

test("isAssetAdminAuthenticated fails closed when the deployment has no usable key", () => {
  const token = assetAdminSessionToken({ MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY });
  assert.ok(token !== null);
  const store = makeCookieStore({ [ASSET_ADMIN_COOKIE_NAME]: token }).store;
  assert.equal(isAssetAdminAuthenticated(store, {}), false);
  assert.equal(isAssetAdminAuthenticated(store, { MYSTCRAG_ASSET_ADMIN_KEY: "short" }), false);
  // Rotating the key invalidates every previously issued session.
  assert.equal(isAssetAdminAuthenticated(store, { MYSTCRAG_ASSET_ADMIN_KEY: `${VALID_KEY}2` }), false);
});

test("a knowledge console cookie never authenticates the bead import console", () => {
  const knowledgeKey = "knowledge-admin-key-0123456789";
  const assetKey = VALID_KEY;
  const store = makeCookieStore({
    [KNOWLEDGE_COOKIE_NAME]: sha256Hex(knowledgeKey),
    [ASSET_ADMIN_COOKIE_NAME]: sha256Hex(knowledgeKey)
  }).store;
  const env = {
    MYSTCRAG_ASSET_ADMIN_KEY: assetKey,
    MYSTCRAG_KNOWLEDGE_ADMIN_KEY: knowledgeKey
  };
  assert.equal(isAssetAdminAuthenticated(store, env), false);
});

test("the same key string yields different tokens for the two consoles", () => {
  const sharedKey = "shared-admin-key-0123456789abcdef";
  const assetToken = assetAdminSessionToken({ MYSTCRAG_ASSET_ADMIN_KEY: sharedKey });
  assert.ok(assetToken !== null);
  assert.notEqual(assetToken, sha256Hex(sharedKey));
  assert.equal(readAssetAdminSessionToken(makeCookieStore().store), null);
});

test("destroyAssetAdminSession removes only the bead import cookie", () => {
  const { store, deletes, sets } = makeCookieStore({
    [ASSET_ADMIN_COOKIE_NAME]: "some-token",
    [KNOWLEDGE_COOKIE_NAME]: "knowledge-token"
  });
  destroyAssetAdminSession(store);
  assert.deepEqual(deletes, [ASSET_ADMIN_COOKIE_NAME]);
  assert.equal(sets.length, 0);
  assert.equal(readAssetAdminSessionToken(store), null);
  // The knowledge console session survives a bead-import logout.
  assert.equal(store.get(KNOWLEDGE_COOKIE_NAME)?.value, "knowledge-token");
});

test("readAssetAdminSessionToken returns the stored token verbatim", () => {
  const token = "a".repeat(64);
  const store = makeCookieStore({ [ASSET_ADMIN_COOKIE_NAME]: token }).store;
  assert.equal(readAssetAdminSessionToken(store), token);
});

test("requireAssetAdminAccess redirects to the not-configured login state", () => {
  const targets: string[] = [];
  const { store } = makeCookieStore();
  assert.throws(() =>
    requireAssetAdminAccess({
      store,
      env: {},
      redirect: (target) => {
        targets.push(target);
        throw new Error(`redirect:${target}`);
      }
    })
  );
  assert.deepEqual(targets, ["/admin/bead-import/login?error=not-configured"]);
});

test("requireAssetAdminAccess redirects unauthenticated visitors to the login page", () => {
  const targets: string[] = [];
  const { store } = makeCookieStore();
  assert.throws(() =>
    requireAssetAdminAccess({
      store,
      env: { MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY },
      redirect: (target) => {
        targets.push(target);
        throw new Error(`redirect:${target}`);
      }
    })
  );
  assert.deepEqual(targets, ["/admin/bead-import/login"]);
});

test("requireAssetAdminAccess lets an authenticated admin through without redirecting", () => {
  const targets: string[] = [];
  const env = { MYSTCRAG_ASSET_ADMIN_KEY: VALID_KEY };
  const token = assetAdminSessionToken(env);
  assert.ok(token !== null);
  const { store } = makeCookieStore({ [ASSET_ADMIN_COOKIE_NAME]: token });
  requireAssetAdminAccess({
    store,
    env,
    redirect: (target) => {
      targets.push(target);
      throw new Error(`redirect:${target}`);
    }
  });
  assert.deepEqual(targets, []);
});

test("the access guard never leaks the configured key or its length in the redirect", () => {
  const key = VALID_KEY;
  for (const env of [{}, { MYSTCRAG_ASSET_ADMIN_KEY: key }] as const) {
    const targets: string[] = [];
    const { store } = makeCookieStore();
    assert.throws(() =>
      requireAssetAdminAccess({
        store,
        env,
        redirect: (target) => {
          targets.push(target);
          throw new Error(`redirect:${target}`);
        }
      })
    );
    for (const target of targets) {
      assert.ok(!target.includes(key));
      assert.ok(!target.includes(sha256Hex(key)));
      assert.match(target, /^\/admin\/bead-import\/login(\?error=not-configured)?$/);
    }
  }
});

test("the rendered login form contains no key material and no configuration values", () => {
  for (const props of [
    { configured: true, error: null },
    { configured: true, error: "invalid" },
    { configured: false, error: "not-configured" }
  ] as const) {
    const markup = renderToStaticMarkup(createElement(AdminLoginForm, props));
    assert.ok(!markup.includes(VALID_KEY));
    assert.ok(!markup.includes(sha256Hex(VALID_KEY)));
    assert.ok(!markup.includes("MYSTCRAG_ASSET_ADMIN_KEY"));
    assert.ok(!markup.includes("ASSET_ADMIN_API_KEY"));
    assert.ok(!markup.includes("x-admin-key"));
    assert.match(markup, /<form/);
    assert.match(markup, /type="password"/);
    assert.match(markup, /minLength="16"/);
    assert.match(markup, /<label[^>]*for="asset-admin-key"/);
    assert.match(markup, /id="asset-admin-key"/);
    assert.match(markup, /type="submit"/);
  }
});

function alertText(markup: string): string {
  const match = /role="alert"[^>]*>([\s\S]*?)</.exec(markup);
  assert.ok(match, "expected a role=alert status region in the login form");
  const text = match[1];
  if (text === undefined) {
    throw new Error("expected the alert region to carry text");
  }
  return text.trim();
}

test("the login form reports an invalid key without revealing the configured value or length", () => {
  const markup = renderToStaticMarkup(createElement(AdminLoginForm, { configured: true, error: "invalid" }));
  assert.ok(!markup.includes(VALID_KEY));
  assert.equal(alertText(markup), "密钥无效，请重新输入。");
});

test("the login form explains an unconfigured deployment without leaking configuration", () => {
  const markup = renderToStaticMarkup(
    createElement(AdminLoginForm, { configured: false, error: "not-configured" })
  );
  assert.equal(alertText(markup), "此部署尚未配置珠子素材管理密钥，暂不可登录。");
  assert.ok(!markup.includes("MYSTCRAG_ASSET_ADMIN_KEY"));
  assert.ok(!markup.includes("ASSET_ADMIN_API_KEY"));
});

test("the login form renders no alert when there is no error", () => {
  const markup = renderToStaticMarkup(createElement(AdminLoginForm, { configured: true, error: null }));
  assert.ok(!markup.includes('role="alert"'));
});

function listFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      listFiles(full, found);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

test("only admin-auth.ts may name the asset admin environment variables", () => {
  const roots = [
    join(__dirname),
    join(__dirname, "..", "..", "..", "app", "admin", "bead-import"),
    join(__dirname, "..", "..", "..", "app", "api", "admin", "bead-import")
  ];
  const mentions: string[] = [];
  for (const root of roots) {
    let files: string[];
    try {
      files = listFiles(root);
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (source.includes("MYSTCRAG_ASSET_ADMIN_KEY") || source.includes("ASSET_ADMIN_API_KEY")) {
        mentions.push(file);
      }
    }
  }
  assert.deepEqual(
    mentions.map((file) => file.split("/").pop()).sort(),
    ["admin-auth.ts"]
  );
});

test("client modules never import the asset admin auth boundary", () => {
  const files = listFiles(__dirname).filter((file) => !file.endsWith(".test.tsx") && !file.endsWith(".test.ts"));
  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!source.includes('"use client"')) {
      continue;
    }
    if (
      /from\s+["'].*admin-auth["']/.test(source) ||
      /from\s+["'].*page-guard["']/.test(source) ||
      source.includes("process.env") ||
      source.includes("x-admin-key")
    ) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});
