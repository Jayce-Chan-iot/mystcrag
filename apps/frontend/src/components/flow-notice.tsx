import Link from "next/link";
import * as React from "react";

import { ERROR_PRESENTATION, type FrontendErrorCode } from "../lib/api/frontend-api-error";

export function FlowNotice({ code, onAction, compact = false }: { code: FrontendErrorCode; onAction?: () => void; compact?: boolean }) {
  const content = ERROR_PRESENTATION[code];
  const tone = content.tone === "danger"
    ? "border-[var(--danger)]/25 bg-[#f8edef] text-[var(--danger)]"
    : content.tone === "warning"
      ? "border-[var(--warning)]/25 bg-[#f8f2e8] text-[var(--warning)]"
      : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--foreground)]";

  const actionHref = code === "EMPTY_STATE" || code === "COMPLIANCE_BLOCKED" || code === "VALIDATION_ERROR" ? "/ai-design" : undefined;

  return (
    <div className={`rounded-2xl border ${tone} ${compact ? "p-4" : "p-6 sm:p-7"}`} role={content.tone === "danger" ? "alert" : "status"} data-error-code={code}>
      <p className="font-medium">{content.title}</p>
      <p className="mt-2 text-sm leading-6 opacity-80">{content.message}</p>
      {actionHref ? (
        <Link className="mt-4 inline-flex text-sm font-semibold underline decoration-current/30 underline-offset-4" href={actionHref}>{content.action}</Link>
      ) : onAction ? (
        <button className="mt-4 text-sm font-semibold underline decoration-current/30 underline-offset-4" onClick={onAction} type="button">{content.action}</button>
      ) : null}
    </div>
  );
}
