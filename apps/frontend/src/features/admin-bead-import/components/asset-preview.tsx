import * as React from "react";

import type { ObjectUrlRegistry } from "../session-lifecycle";
import {
  createPreviewLoader,
  type PreviewLoaderClient,
  type PreviewOutcome
} from "../preview-loader";
import { HINT_CLASS } from "./control-styles";

/**
 * One admin image preview. The bytes come from the same-origin proxy through
 * the preview loader, and a refusal — an ARW original, most notably — becomes
 * an explicit operator-readable state instead of a broken image. Nothing here
 * ever learns where the bytes live.
 */

export type AssetPreviewProps = {
  label: string;
  kind: "source" | "processed";
  id: string;
  rendition?: "main" | "thumbnail";
  client: PreviewLoaderClient;
  objectUrls: ObjectUrlRegistry;
};

export type ViewState = { status: "LOADING" } | PreviewOutcome;

const LOADING_TEXT = "正在加载预览…";
const UNSUPPORTED_TEXT = "该格式不支持浏览器预览，原文件已安全保留，处理与发布不受影响。";
const ERROR_TEXT = "预览暂时无法加载，请稍后重试。";

function viewTone(view: ViewState): string {
  if (view.status === "UNSUPPORTED") {
    return HINT_CLASS;
  }
  return view.status === "ERROR" ? "text-[var(--danger)]" : "text-[var(--muted)]";
}

function viewText(view: ViewState): string {
  switch (view.status) {
    case "LOADING":
      return LOADING_TEXT;
    case "UNSUPPORTED":
      return UNSUPPORTED_TEXT;
    case "ERROR":
      return ERROR_TEXT;
    default:
      // A READY view renders the image instead of text.
      return "";
  }
}

/**
 * The component's effect lifecycle, as one testable unit. Every run creates its
 * own loader, so the terminal `release()` in the returned cleanup can never
 * brick a later run — a retry, a prop change or a Strict-Mode replay mounts a
 * fresh lifecycle, while the outgoing one aborts its read and can never track
 * a late response or revoke a newer run's URL.
 */
export function mountAssetPreviewEffect(input: {
  kind: "source" | "processed";
  id: string;
  rendition?: "main" | "thumbnail";
  client: PreviewLoaderClient;
  objectUrls: ObjectUrlRegistry;
  createAbortController?: () => { signal: { aborted: boolean }; abort: (reason?: unknown) => void };
  onState: (view: ViewState) => void;
}): () => void {
  const loader = createPreviewLoader({
    client: input.client,
    objectUrls: input.objectUrls,
    ...(input.createAbortController === undefined
      ? {}
      : { createAbortController: input.createAbortController })
  });
  let alive = true;
  const request =
    input.kind === "source"
      ? loader.loadSource(input.id)
      : loader.loadProcessed(input.id, input.rendition ?? "main");
  void request.then((next) => {
    if (alive) {
      input.onState(next);
    }
  });
  return () => {
    alive = false;
    loader.release();
  };
}

export function AssetPreview({ label, kind, id, rendition, client, objectUrls }: AssetPreviewProps) {
  const [view, setView] = React.useState<ViewState>({ status: "LOADING" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    // Reset before the fresh lifecycle's own outcome lands; the reload button
    // needs this so a failed preview does not keep showing its old verdict.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset precedes an async load owned by this effect
    setView({ status: "LOADING" });
    return mountAssetPreviewEffect({
      kind,
      id,
      rendition,
      client,
      objectUrls,
      onState: setView
    });
  }, [client, objectUrls, kind, id, rendition, attempt]);

  return (
    <figure className="flex min-w-0 flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-2">
      <figcaption className="min-w-0 break-all text-xs font-medium">{label}</figcaption>
      {view.status === "READY" ? (
        // eslint-disable-next-line @next/next/no-img-element -- the bytes are a same-origin admin Blob, not a public asset URL
        <img
          src={view.url}
          alt={label}
          className="mx-auto h-40 w-auto max-w-full rounded-lg object-contain sm:h-48"
        />
      ) : (
        <>
          <p role="status" className={`min-w-0 break-all text-xs ${viewTone(view)}`}>
            {viewText(view)}
          </p>
          {view.status === "ERROR" && (
            <button
              type="button"
              onClick={() => {
                setView({ status: "LOADING" });
                setAttempt((value) => value + 1);
              }}
              className="self-start text-xs text-[var(--accent)] underline"
            >
              重新加载
            </button>
          )}
        </>
      )}
    </figure>
  );
}
