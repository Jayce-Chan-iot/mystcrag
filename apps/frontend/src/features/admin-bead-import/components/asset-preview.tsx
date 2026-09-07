import * as React from "react";

import type { ObjectUrlRegistry } from "../session-lifecycle";
import { createPreviewLoader, type PreviewLoaderClient, type PreviewOutcome } from "../preview-loader";
import { HINT_CLASS } from "./control-styles";

/**
 * One admin image preview. The bytes come from the same-origin proxy through
 * the preview loader, the object URL is revoked on unmount, and a refusal —
 * an ARW original, most notably — becomes an explicit operator-readable state
 * instead of a broken image. Nothing here ever learns where the bytes live.
 */

export type AssetPreviewProps = {
  label: string;
  kind: "source" | "processed";
  id: string;
  rendition?: "main" | "thumbnail";
  client: PreviewLoaderClient;
  objectUrls: ObjectUrlRegistry;
};

type ViewState = { status: "LOADING" } | PreviewOutcome;

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

export function AssetPreview({ label, kind, id, rendition, client, objectUrls }: AssetPreviewProps) {
  const loader = React.useMemo(
    () => createPreviewLoader({ client, objectUrls }),
    [client, objectUrls]
  );
  const [view, setView] = React.useState<ViewState>({ status: "LOADING" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    const request =
      kind === "source"
        ? loader.loadSource(id)
        : loader.loadProcessed(id, rendition ?? "main");
    void request.then((next) => {
      if (alive) {
        setView(next);
      }
    });
    return () => {
      alive = false;
      loader.release();
    };
  }, [loader, kind, id, rendition, attempt]);

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
