import assert from "node:assert/strict";
import test from "node:test";

import {
  isNoProxyHost,
  noProxyHostsFromEnv,
  proxyConfigurationFromEnv,
  proxyUrlsFromEnv
} from "../src/fetchers/proxy.js";

test("proxyUrlsFromEnv dedupes scheme variants in precedence order", () => {
  const urls = proxyUrlsFromEnv({
    HTTPS_PROXY: "http://proxy-a:7897",
    https_proxy: "http://proxy-a:7897",
    HTTP_PROXY: "http://proxy-b:7897"
  });
  assert.deepEqual(urls, ["http://proxy-a:7897", "http://proxy-b:7897"]);
  assert.deepEqual(proxyUrlsFromEnv({}), []);
});

test("noProxyHostsFromEnv splits entries case-insensitively", () => {
  assert.deepEqual(
    noProxyHostsFromEnv({ NO_PROXY: "Example.COM, localhost 192.168.0.0/16" }),
    ["example.com", "localhost", "192.168.0.0/16"]
  );
  assert.deepEqual(noProxyHostsFromEnv({}), []);
});

test("isNoProxyHost matches exact hosts, dot suffixes, and the wildcard", () => {
  const hosts = ["example.com", ".internal.org"];
  assert.equal(isNoProxyHost("example.com", hosts), true);
  assert.equal(isNoProxyHost("api.example.com", hosts), true);
  assert.equal(isNoProxyHost("notexample.com", hosts), false);
  assert.equal(isNoProxyHost("svc.internal.org", hosts), true);
  assert.equal(isNoProxyHost("internal.org.evil.net", hosts), false);
  assert.equal(isNoProxyHost("anything.test", ["*"]), true);
  assert.equal(isNoProxyHost("anything.test", ["example.com"]), false);
});

test("proxyConfigurationFromEnv bypasses loopback and NO_PROXY hosts, proxies the rest", async () => {
  const proxy = proxyConfigurationFromEnv({
    HTTPS_PROXY: "http://proxy:7897",
    NO_PROXY: "wikipedia.org"
  });
  assert.ok(proxy !== undefined);

  const directLocal = await proxy.newUrl("session-1", {
    request: { url: "http://127.0.0.1:45678/amethyst.html" } as never
  });
  assert.ok(
    directLocal == null,
    "loopback fixture servers must connect directly (no proxy URL)"
  );

  const directNoProxy = await proxy.newUrl("session-2", {
    request: { url: "https://en.wikipedia.org/wiki/Amethyst" } as never
  });
  assert.ok(
    directNoProxy == null,
    "NO_PROXY suffix match must bypass the proxy"
  );

  const proxied = await proxy.newUrl("session-3", {
    request: { url: "https://www.gemdat.org/gem-819.html" } as never
  });
  assert.equal(proxied, "http://proxy:7897");
});

test("proxyConfigurationFromEnv stays undefined without proxy environment", () => {
  assert.equal(proxyConfigurationFromEnv({}), undefined);
  assert.equal(proxyConfigurationFromEnv({ NO_PROXY: "example.com" }), undefined);
});
