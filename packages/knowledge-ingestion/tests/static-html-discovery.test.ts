import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import test from "node:test";

import type { StoredKnowledgeSource } from "@mystcrag/database";

import { fetchHtmlDocuments } from "../src/index";

function page(title: string, body: string, links: string[]): string {
  return `<!doctype html><html><body><article><h1>${title}</h1><p>${body}</p>${links
    .map((link) => `<a href="${link}">${link}</a>`)
    .join("")}</article></body></html>`;
}

type FixtureServer = {
  base: string;
  fetched: string[];
  close(): void;
};

async function startServer(
  routes: Record<string, { body?: string; links?: string[]; html?: string }>
): Promise<FixtureServer> {
  const fetched: string[] = [];
  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }
    fetched.push(url);
    const route = routes[url];
    if (route === undefined) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      route.html ?? page(url, route.body ?? "", route.links ?? [])
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return {
    base: `http://127.0.0.1:${address.port}`,
    fetched,
    // Crawlee's keep-alive sockets keep the event loop alive for minutes
    // after run() returns; unref them so node --test can exit promptly.
    close: () => {
      server.close();
      server.closeAllConnections();
      const activeHandles = (
        process as unknown as { _getActiveHandles?: () => unknown[] }
      )._getActiveHandles?.() ?? [];
      for (const handle of activeHandles) {
        if ((handle as { constructor?: { name?: string } })?.constructor?.name === "Socket") {
          (handle as { unref?: () => void }).unref?.();
        }
      }
    }
  };
}

function source(base: string, crawlStrategy: object, path = "/gems/index.html"): StoredKnowledgeSource {
  return {
    id: "source-discovery-fixture",
    name: "Discovery fixture",
    sourceType: "STATIC_HTML",
    baseUrl: `${base}${path}`,
    enabled: true,
    authorityScore: 0.7,
    allowedKnowledgeDomains: ["knowledge-domain:gemological-fact"],
    language: "en",
    sourceCategory: "GEMOLOGY",
    reliabilityLevel: "HIGH",
    crawlStrategy: crawlStrategy as StoredKnowledgeSource["crawlStrategy"],
    reviewStatus: "APPROVED"
  } as StoredKnowledgeSource;
}

test("pathPatterns allowlist restricts discovered child pages to gem profiles", async () => {
  const server = await startServer({
    "/gems/index.html": {
      body: "Gem index",
      links: ["/gems/amethyst.html", "/gems/aquamarine.html", "/articles/editorial.html"]
    },
    "/gems/amethyst.html": { body: "Mohs Hardness 7", links: [] },
    "/gems/aquamarine.html": { body: "Mohs Hardness 7.5-8", links: [] },
    "/articles/editorial.html": { body: "Off-pattern page", links: [] }
  });
  const storageDir = mkdtempSync(`${tmpdir()}/mystcrag-discovery-`);
  try {
    const documents = await fetchHtmlDocuments(source(server.base, {}), {
      allowPrivateNetworks: true,
      storageDir,
      maxPages: 10,
      followLinks: true,
      pathPatterns: ["/gems/*.html"],
      maxDepth: 1
    });
    const urls = documents.map((document) => new URL(document.url).pathname).sort();
    assert.deepEqual(urls, ["/gems/amethyst.html", "/gems/aquamarine.html", "/gems/index.html"]);
    assert.equal(server.fetched.includes("/articles/editorial.html"), false);
  } finally {
    rmSync(storageDir, { recursive: true, force: true });
    server.close();
  }
});

test("maxDepth 1 stops discovery at direct children", async () => {
  const server = await startServer({
    "/gems/index.html": {
      body: "Gem index",
      links: ["/gems/amethyst.html"]
    },
    "/gems/amethyst.html": { body: "Profile", links: ["/gems/nested/deep.html"] },
    "/gems/nested/deep.html": { body: "Two hops away", links: [] }
  });
  const storageDir = mkdtempSync(`${tmpdir()}/mystcrag-discovery-`);
  try {
    const documents = await fetchHtmlDocuments(source(server.base, {}), {
      allowPrivateNetworks: true,
      storageDir,
      maxPages: 10,
      followLinks: true,
      pathPatterns: ["/gems/*.html"],
      maxDepth: 1
    });
    const paths = documents.map((document) => new URL(document.url).pathname);
    assert.equal(paths.includes("/gems/nested/deep.html"), false);
  } finally {
    rmSync(storageDir, { recursive: true, force: true });
    server.close();
  }
});

test("without pathPatterns, same-origin discovery behaves as before", async () => {
  const server = await startServer({
    "/gems/index.html": {
      body: "Gem index",
      links: ["/gems/amethyst.html", "/articles/editorial.html"]
    },
    "/gems/amethyst.html": { body: "Profile", links: [] },
    "/articles/editorial.html": { body: "Same-origin editorial", links: [] }
  });
  const storageDir = mkdtempSync(`${tmpdir()}/mystcrag-discovery-`);
  try {
    const documents = await fetchHtmlDocuments(source(server.base, {}), {
      allowPrivateNetworks: true,
      storageDir,
      maxPages: 10,
      followLinks: true,
      maxDepth: 1
    });
    const paths = documents.map((document) => new URL(document.url).pathname);
    assert.equal(paths.includes("/articles/editorial.html"), true);
  } finally {
    rmSync(storageDir, { recursive: true, force: true });
    server.close();
  }
});

test("seedPaths enqueue explicit gem profiles the index page cannot reveal (JS-rendered grids)", async () => {
  const server = await startServer({
    "/gems/index.html": { body: "Gem grid rendered client-side; no static links" },
    "/gems/amethyst.html": { body: "Mohs Hardness 7", links: [] },
    "/gems/aquamarine.html": { body: "Mohs Hardness 7.5-8", links: [] }
  });
  const storageDir = mkdtempSync(`${tmpdir()}/mystcrag-discovery-`);
  try {
    const documents = await fetchHtmlDocuments(source(server.base, {}), {
      allowPrivateNetworks: true,
      storageDir,
      maxPages: 10,
      followLinks: false,
      seedPaths: ["/gems/amethyst.html", "/gems/aquamarine.html"]
    });
    const urls = documents.map((document) => new URL(document.url).pathname).sort();
    assert.deepEqual(urls, [
      "/gems/amethyst.html",
      "/gems/aquamarine.html",
      "/gems/index.html"
    ]);
  } finally {
    rmSync(storageDir, { recursive: true, force: true });
    server.close();
  }
});

test("seedPaths are bounded by maxPages like every other request", async () => {
  const server = await startServer({
    "/gems/index.html": { body: "Index" },
    "/gems/amethyst.html": { body: "Profile", links: [] },
    "/gems/aquamarine.html": { body: "Profile", links: [] },
    "/gems/garnet.html": { body: "Profile", links: [] }
  });
  const storageDir = mkdtempSync(`${tmpdir()}/mystcrag-discovery-`);
  try {
    // maxConcurrency 2 lets at most one in-flight request slip past the
    // maxRequestsPerCrawl counter (3 of 4 queued), but the queue never runs on.
    const documents = await fetchHtmlDocuments(source(server.base, {}), {
      allowPrivateNetworks: true,
      storageDir,
      maxPages: 2,
      followLinks: false,
      seedPaths: [
        "/gems/amethyst.html",
        "/gems/aquamarine.html",
        "/gems/garnet.html"
      ]
    });
    assert.equal(documents.length <= 3, true);
    assert.equal(server.fetched.includes("/gems/garnet.html"), false);
  } finally {
    rmSync(storageDir, { recursive: true, force: true });
    server.close();
  }
});

test("table cell text is space-separated so gem profile labels stay readable", async () => {
  const server = await startServer({
    "/gems/amethyst.html": {
      html: `<!doctype html><html><head><title>Amethyst gemstone information</title></head><body><table class="gemshowtable"><tr><th>Mohs Hardness</th><td><span>7</span><a>Walter Schumann, Gemstones of the world (2001)</a></td></tr><tr><th>Crystal System</th><td><span>Trigonal</span><a>Ulrich Henn, Gemmological Tables (2004)</a></td></tr></table></body></html>`
    }
  });
  const storageDir = mkdtempSync(`${tmpdir()}/mystcrag-discovery-`);
  try {
    const documents = await fetchHtmlDocuments(
      source(server.base, { maxPages: 1, followLinks: false, respectRobots: true }, "/gems/amethyst.html"),
      { allowPrivateNetworks: true, storageDir, maxPages: 1 }
    );
    const contentText = documents[0]?.contentText ?? "";
    assert.match(contentText, /Mohs Hardness 7/);
    assert.match(contentText, /Crystal System Trigonal/);
    assert.equal(contentText.includes("Hardness7"), false);
  } finally {
    rmSync(storageDir, { recursive: true, force: true });
    server.close();
  }
});
