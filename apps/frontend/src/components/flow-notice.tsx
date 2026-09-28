import Link from "next/link";
import * as React from "react";

import { AuthRequiredDialog } from "../features/auth/browser/auth-required-dialog";
import { ERROR_PRESENTATION, type FrontendErrorCode } from "../lib/api/frontend-api-error";

export type NoticeButtonAction = { kind: "button"; label: string; onAction(): void };
export type NoticeLinkAction = { kind: "link"; label: string; href: string };
export type NoticeAction = NoticeButtonAction | NoticeLinkAction;

export type FlowNoticeProps = {
  code: FrontendErrorCode;
  action?: NoticeAction;
  onDismissAuthRequired?: () => void;
  compact?: boolean;
};

const ACTION_CLASS = "mt-4 inline-flex min-h-11 items-center text-sm font-semibold underline decoration-current/30 underline-offset-4";

export function FlowNotice({ code, action, onDismissAuthRequired, compact = false }: FlowNoticeProps) {
  if (code === "UNAUTHORIZED") {
    // The auth prompt is a pure login gate: dismissing it ("暂不登录") must never trigger
    // the business retry/re-submit passed as `action`. `onDismissAuthRequired` only
    // clears the parent's authentication error state so a later 401 remounts the dialog.
    return <AuthRequiredDialog onDismiss={onDismissAuthRequired} />;
  }

  const content = ERROR_PRESENTATION[code];
  const tone = content.tone === "danger"
    ? "border-[var(--danger)]/25 bg-[#f8edef] text-[var(--danger)]"
    : content.tone === "warning"
      ? "border-[var(--warning)]/25 bg-[#f8f2e8] text-[var(--warning)]"
      : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--foreground)]";

  return (
    <div className={`rounded-2xl border ${tone} ${compact ? "p-4" : "p-6 sm:p-7"}`} role={content.tone === "danger" ? "alert" : "status"} data-error-code={code}>
      <p className="font-medium">{content.title}</p>
      <p className="mt-2 text-sm leading-6 opacity-80">{content.message}</p>
      {action?.kind === "link" ? (
        <Link className={ACTION_CLASS} href={action.href}>{action.label}</Link>
      ) : action?.kind === "button" ? (
        <button className={ACTION_CLASS} onClick={action.onAction} type="button">{action.label}</button>
      ) : null}
    </div>
  );
}
