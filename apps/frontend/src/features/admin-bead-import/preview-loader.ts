import { BeadImportApiError, type BeadImportBinaryContent } from "./api-client";
import type { AbortHandle, ObjectUrlRegistry } from "./session-lifecycle";

/**
 * Owns the browser side of an admin image preview: one binary read at a time,
 * one tracked object URL, and a typed outcome for every refusal. Every read
 * carries its own AbortController, so switching previews or unmounting aborts
 * the wire instead of letting a 256 MiB response finish into the void, and a
 * response that arrives after the loader was released can never create — or
 * leave behind — an object URL. A preview the Backend will not serve (an ARW
 * original, for instance) becomes an explicit UNSUPPORTED state an operator can
 * read, never a broken image and never a leaked storage key.
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
  /** Aborts any in-flight read and revokes the tracked URL; the loader stays usable. */
  cancel(): void;
  /** Terminal: aborts, revokes, and guarantees no future URL is ever tracked. */
  release(): void;
};

export function createPreviewLoader(deps: {
  client: PreviewLoaderClient;
  objectUrls: ObjectUrlRegistry;
  createAbortController?: () => AbortHandle;
}): PreviewLoader {
  const createAbortController =
    deps.createAbortController ??
    (() => {
      const controller = new AbortController();
      return { signal: controller.signal, abort: (reason?: unknown) => controller.abort(reason) };
    });

  let released = false;
  let currentUrl: string | null = null;
  let nextCallId = 0;
  let inFlight: { id: number; controller: AbortHandle } | null = null;

  function revoke(): void {
    if (currentUrl === null) {
      return;
    }
    deps.objectUrls.revokeObjectUrl(currentUrl);
    currentUrl = null;
  }

  function cancel(): void {
    inFlight?.controller.abort("bead import preview superseded");
    inFlight = null;
    revoke();
  }

  function release(): void {
    released = true;
    cancel();
  }

  function track(blob: Blob): string {
    // Only reachable when not released and this call is still the current one,
    // so a late response can never mint a URL nobody will revoke.
    revoke();
    currentUrl = deps.objectUrls.createObjectUrl(blob);
    return currentUrl;
  }

  async function load(
    read: (signal: AbortSignal | undefined) => Promise<BeadImportBinaryContent>
  ): Promise<PreviewOutcome> {
    if (released) {
      return { status: "ERROR" };
    }
    cancel();
    const id = (nextCallId += 1);
    const controller = createAbortController();
    inFlight = { id, controller };
    try {
      const content = await read(controller.signal as AbortSignal | undefined);
      if (released || inFlight?.id !== id) {
        return { status: "ERROR" };
      }
      inFlight = null;
      return { status: "READY", url: track(content.blob), contentType: content.contentType };
    } catch (error) {
      if (inFlight?.id === id) {
        inFlight = null;
      }
      if (released) {
        return { status: "ERROR" };
      }
      if (error instanceof BeadImportApiError && error.assetCode === "SOURCE_PREVIEW_UNAVAILABLE") {
        return { status: "UNSUPPORTED" };
      }
      return { status: "ERROR" };
    }
  }

  return {
    loadSource: (fileId) => load((signal) => deps.client.readSourceFileContent(fileId, { signal })),
    loadProcessed: (processedAssetId, rendition) =>
      load((signal) => deps.client.readProcessedAssetContent(processedAssetId, rendition, { signal })),
    cancel,
    release
  };
}
