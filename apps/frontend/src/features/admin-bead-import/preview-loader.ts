import { BeadImportApiError, type BeadImportBinaryContent } from "./api-client";
import type { ObjectUrlRegistry } from "./session-lifecycle";

/**
 * Owns the browser side of an admin image preview: one binary read at a time,
 * one tracked object URL, and a typed outcome for every refusal. A preview the
 * Backend will not serve (an ARW original, for instance) becomes an explicit
 * UNSUPPORTED state an operator can read, never a broken image and never a
 * leaked storage key.
 */

export type PreviewOutcome =
  | { status: "READY"; url: string; contentType: string | null }
  | { status: "UNSUPPORTED" }
  | { status: "ERROR" };

export type PreviewLoaderClient = {
  readSourceFileContent(
    fileId: string,
    requestOptions?: { signal?: AbortSignal }
  ): Promise<BeadImportBinaryContent>;
  readProcessedAssetContent(
    processedAssetId: string,
    rendition: "main" | "thumbnail",
    requestOptions?: { signal?: AbortSignal }
  ): Promise<BeadImportBinaryContent>;
};

export type PreviewLoader = {
  loadSource(fileId: string): Promise<PreviewOutcome>;
  loadProcessed(processedAssetId: string, rendition: "main" | "thumbnail"): Promise<PreviewOutcome>;
  release(): void;
};

export function createPreviewLoader(deps: {
  client: PreviewLoaderClient;
  objectUrls: ObjectUrlRegistry;
}): PreviewLoader {
  let currentUrl: string | null = null;

  function track(blob: Blob): string {
    release();
    currentUrl = deps.objectUrls.createObjectUrl(blob);
    return currentUrl;
  }

  function release(): void {
    if (currentUrl === null) {
      return;
    }
    deps.objectUrls.revokeObjectUrl(currentUrl);
    currentUrl = null;
  }

  async function load(read: () => Promise<BeadImportBinaryContent>): Promise<PreviewOutcome> {
    try {
      const content = await read();
      return { status: "READY", url: track(content.blob), contentType: content.contentType };
    } catch (error) {
      if (
        error instanceof BeadImportApiError &&
        error.assetCode === "SOURCE_PREVIEW_UNAVAILABLE"
      ) {
        return { status: "UNSUPPORTED" };
      }
      return { status: "ERROR" };
    }
  }

  return {
    loadSource: (fileId) => load(() => deps.client.readSourceFileContent(fileId)),
    loadProcessed: (processedAssetId, rendition) =>
      load(() => deps.client.readProcessedAssetContent(processedAssetId, rendition)),
    release
  };
}
