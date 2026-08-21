import { randomUUID } from "node:crypto";

import { CheerioCrawler, RequestQueue, RobotsTxtFile, type CheerioRoot } from "crawlee";

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

/**
 * Static / multi-page HTML source via Crawlee's CheerioCrawler (task book
 * section 28: reuse Crawlee, default to Cheerio; Playwright stays opt-in per
 * source). Robots.txt is enforced by Crawlee's native support: the start URL
 * is checked up front (a disallowed source is a configuration error worth
 * surfacing), and every followed link is filtered by `respectRobotsTxtFile`.
 *
 * Each run gets its own uniquely named request queue inside the storage dir,
 * because Crawlee's named queues remember handled requests — reusing the
 * default queue would silently skip every URL on the next crawl of the same
 * source.
 */
export async function fetchHtmlDocuments(
  source: StoredKnowledgeSource,
  options?: {
    allowPrivateNetworks?: boolean;
    maxPages?: number;
    followLinks?: boolean;
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
  const documents = new Map<string, FetchedHtmlDocument>();
  const limiter = createRequestRateLimiter(source.rateLimit?.maxRequestsPerMinute);

  const requestQueue = await RequestQueue.open(`ingestion-${randomUUID()}`);
  await requestQueue.addRequest({ url: source.baseUrl });

  const crawler = new CheerioCrawler({
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
      if (followLinks && documents.size < maxPages) {
        await enqueueLinks({ strategy: "same-origin" });
      }
      log.debug(`parsed ${request.url}`);
    }
  });

  await crawler.run();
  return [...documents.values()].sort((left, right) => (left.url < right.url ? -1 : 1));
}
