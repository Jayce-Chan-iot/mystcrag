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

const ACTION_CLASS = "star-system-action mt-4 inline-flex min-h-11 items-center text-sm font-semibold underline decoration-current/30 underline-offset-4";

function flowTone(code: FrontendErrorCode): "info" | "warning" | "danger" {
  const tone = ERROR_PRESENTATION[code].tone;
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  return "info";
}

/**
 * Inline notice for every non-auth flow code. The frame is the star `flow-notice`
 * surface, so an inline network/empty notice reads from the same star tokens as a
 * full-page system state instead of the previous hardcoded legacy hex palette.
 * The caller still owns the single action control, so a retry (button) and a
 * destination (link) stay distinguishable and no notice invents either one.
 */
export function FlowNotice({ code, action, onDismissAuthRequired, compact = false }: FlowNoticeProps) {
  if (code === "UNAUTHORIZED") {
    // The auth prompt is a pure login gate: dismissing it ("暂不登录") must never trigger
    // the business retry/re-submit passed as `action`. `onDismissAuthRequired` only
    // clears the parent's authentication error state so a later 401 remounts the dialog.
    return <AuthRequiredDialog onDismiss={onDismissAuthRequired} />;
  }

  const content = ERROR_PRESENTATION[code];

  return (
    <div
      className="star-flow-notice"
      data-compact={compact ? "true" : "false"}
      data-error-code={code}
      data-star-flow-tone={flowTone(code)}
      data-star-surface="flow-notice"
      data-star-system-state={code}
      role={content.tone === "danger" ? "alert" : "status"}
    >
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
