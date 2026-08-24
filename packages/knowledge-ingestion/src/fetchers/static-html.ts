import { randomUUID } from "node:crypto";

import {
  CheerioCrawler,
  Configuration,
  RequestQueue,
  RobotsTxtFile,
  type CheerioRoot
} from "crawlee";

import type { StoredKnowledgeSource } from "@mystcrag/database";

import { createRequestRateLimiter } from "../rate-limit.js";
import { proxyConfigurationFromEnv, proxyUrlsFromEnv } from "./proxy.js";
import { assertPublicUrl, isPrivateHostname } from "../security.js";

export type FetchedHtmlDocument = {
  url: string;
  title: string;
  contentText: string;
};

/** Inline-block elements whose text Cheerio would otherwise glue together. */
const BLOCK_TEXT_ELEMENTS = "th,td,tr,p,div,li,h1,h2,h3,h4,h5,h6,br,section,article,table";

function extractDocument(url: string, $: CheerioRoot): FetchedHtmlDocument {
  const title =
    $("article h1").first().text().trim() ||
    $("main h1").first().text().trim() ||
    $("title").first().text().trim() ||
    url;
  // Gem profile datasheets lay facts out in table cells; without a separator
  // "Mohs Hardness</th><td>7" would read "Mohs Hardness7" and defeat every
  // label-value extractor downstream. A trailing space per block element
  // keeps cells, paragraphs, and headings word-separated.
  $(BLOCK_TEXT_ELEMENTS).each((_, element) => {
    $(element).append(" ");
  });
  const contentText =
    $("article").first().text() ||
    $("main").first().text() ||
    $("body").text();
  return {
    url,
    title: title.slice(0, 300),
    contentText: contentText.replace(/\s+/g, " ").trim().slice(0, 200_000)
  };
}

/** Root-relative path patterns become absolute URL globs for enqueueLinks. */
function toUrlGlobs(baseUrl: string, pathPatterns: readonly string[]): string[] {
  return pathPatterns.map((pattern) => new URL(pattern, baseUrl).toString());
}

/**
 * Static / multi-page HTML source via Crawlee's CheerioCrawler (task book
 * section 28: reuse Crawlee, default to Cheerio; Playwright stays opt-in per
 * source). Robots.txt is enforced by Crawlee's native support: the start URL
 * is checked up front (a disallowed source is a configuration error worth
 * surfacing), and every followed link is filtered by `respectRobotsTxtFile`.
 *
 * Batch B child-page discovery: `pathPatterns` restricts followed links to an
 * allowlist of path globs (e.g. "/gem-*.html") and `maxDepth` bounds how many
 * hops from the base URL may be enqueued — no whole-site crawling.
 *
 * Each run gets its own uniquely named request queue inside the storage dir,
 * because Crawlee's named queues remember handled requests — reusing the
 * default queue would silently skip every URL on the next crawl of the same
 * source.
 *
 * A per-crawl `Configuration` slows the system-info poll from its 1s default:
 * that default spawns a `ps` child process every second and its interval keeps
 * the Node event loop alive long after `run()` returns, which hangs short CLI
 * crawls and test runs.
 */
export async function fetchHtmlDocuments(
  source: StoredKnowledgeSource,
  options?: {
    allowPrivateNetworks?: boolean;
    maxPages?: number;
    followLinks?: boolean;
    /** Allowlist of root-relative path globs; discovered links must match one. */
    pathPatterns?: readonly string[];
    /** Discovery depth from the base URL (1 = base + direct children). */
    maxDepth?: number;
    /**
     * Explicit root-relative crawl targets enqueued directly alongside the base
     * URL (Batch B taxonomy targeting). Seed requests are issued even without
     * link discovery, because the profile index is JS-rendered.
     */
    seedPaths?: readonly string[];
    storageDir?: string;
  }
): Promise<FetchedHtmlDocument[]> {
  if (source.baseUrl === undefined) {
    throw new Error(`HTML_SOURCE_REQUIRES_BASE_URL: ${source.id}`);
  }
  await assertPublicUrl(source.baseUrl, options);
  if (options?.storageDir !== undefined) {
    process.env.CRAWLEE_STORAGE_DIR = options.storageDir;
  }

  let robots: RobotsTxtFile | null = null;
  try {
    // The robots.txt prefetch rides the egress proxy too: on hosts whose DNS
    // is polluted (en.wikipedia.org resolves to unrelated blocked IPs without
    // it) a direct fetch burns its full timeout, and Crawlee's per-request
    // robots fetch would re-pay that on every single request.
    const proxyUrl = isPrivateHostname(new URL(source.baseUrl).hostname)
      ? undefined
      : proxyUrlsFromEnv()[0];
    robots = await RobotsTxtFile.find(source.baseUrl, proxyUrl, {
      timeoutMillis: 10_000
    });
  } catch {
    robots = null;
  }
  if (robots !== null && !robots.isAllowed(source.baseUrl)) {
    throw new Error(`ROBOTS_TXT_DISALLOWED: ${source.baseUrl}`);
  }

  const maxPages = Math.min(Math.max(options?.maxPages ?? 10, 1), 100);
  const followLinks = options?.followLinks === true;
  const pathPatterns = options?.pathPatterns;
  const maxDepth = Math.min(Math.max(options?.maxDepth ?? 1, 1), 3);
  const documents = new Map<string, FetchedHtmlDocument>();
  const limiter = createRequestRateLimiter(source.rateLimit?.maxRequestsPerMinute);

  const requestQueue = await RequestQueue.open(`ingestion-${randomUUID()}`);
  await requestQueue.addRequest({ url: source.baseUrl });
  for (const seedPath of options?.seedPaths ?? []) {
    const seedUrl = new URL(seedPath, source.baseUrl).toString();
    if (seedUrl === source.baseUrl) continue;
    await requestQueue.addRequest({ url: seedUrl });
  }

  const config = new Configuration({ systemInfoIntervalMillis: 3_600_000 });
  const proxyConfiguration = proxyConfigurationFromEnv();
  const crawler = new CheerioCrawler(
    {
      requestQueue,
      respectRobotsTxtFile: true,
      maxRequestsPerCrawl: maxPages,
      maxConcurrency: 2,
      requestHandlerTimeoutSecs: 15,
      navigationTimeoutSecs: 15,
      // Sources unreachable without the environment's egress proxy (curl
      // honours HTTPS_PROXY; Node does not) connect through it when present.
      ...(proxyConfiguration === undefined ? {} : { proxyConfiguration }),
      preNavigationHooks: limiter === null ? [] : [async () => void (await limiter.acquire())],
      async requestHandler({ request, $, enqueueLinks, log }) {
        const document = extractDocument(request.url, $);
        documents.set(document.url, document);
        const depth =
          typeof request.userData.depth === "number" ? request.userData.depth : 0;
        if (followLinks && documents.size < maxPages && depth < maxDepth) {
          await enqueueLinks({
            strategy: "same-origin",
            ...(pathPatterns === undefined
              ? {}
              : { globs: toUrlGlobs(source.baseUrl as string, pathPatterns) }),
            userData: { depth: depth + 1 }
          });
        }
        log.debug(`parsed ${request.url}`);
      }
    },
    config
  );

  // Pre-seed Crawlee's per-origin robots cache so no request ever triggers its
  // internal robots.txt fetch — that fetch connects directly (no proxy) and on
  // DNS-polluted hosts stalls for tens of seconds before failing per request.
  // On prefetch failure an allow-all file preserves Crawlee's fail-open rule.
  const baseUrlOrigin = new URL(source.baseUrl).origin;
  const cachedRobots =
    robots ??
    RobotsTxtFile.from(`${baseUrlOrigin}/robots.txt`, "User-agent: *\nAllow: /");
  (crawler as unknown as RobotsTxtCacheHolder).robotsTxtFileCache.add(
    baseUrlOrigin,
    cachedRobots
  );

  await crawler.run();
  return [...documents.values()].sort((left, right) => (left.url < right.url ? -1 : 1));
}

/** Crawlee's per-origin robots cache is private in the typings but present on the instance. */
type RobotsTxtCacheHolder = {
  robotsTxtFileCache: { add(origin: string, file: RobotsTxtFile): void };
};
