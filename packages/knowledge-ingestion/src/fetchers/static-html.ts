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
import { assertPublicUrl } from "../security.js";

export type FetchedHtmlDocument = {
  url: string;
  title: string;
  contentText: string;
};

function extractDocument(url: string, $: CheerioRoot): FetchedHtmlDocument {
  const title =
    $("article h1").first().text().trim() ||
    $("main h1").first().text().trim() ||
    $("title").first().text().trim() ||
    url;
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
    robots = await RobotsTxtFile.find(source.baseUrl, undefined, { timeoutMillis: 10_000 });
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

  const config = new Configuration({ systemInfoIntervalMillis: 3_600_000 });
  const crawler = new CheerioCrawler(
    {
      requestQueue,
      respectRobotsTxtFile: true,
      maxRequestsPerCrawl: maxPages,
      maxConcurrency: 2,
      requestHandlerTimeoutSecs: 15,
      navigationTimeoutSecs: 15,
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

  await crawler.run();
  return [...documents.values()].sort((left, right) => (left.url < right.url ? -1 : 1));
}
