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

async function startServer(routes: Record<string, { body: string; links: string[] }>): Promise<FixtureServer> {
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
    response.end(page(url, route.body, route.links));
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

function source(base: string, crawlStrategy: object): StoredKnowledgeSource {
  return {
    id: "source-discovery-fixture",
    name: "Discovery fixture",
    sourceType: "STATIC_HTML",
    baseUrl: `${base}/gems/index.html`,
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
