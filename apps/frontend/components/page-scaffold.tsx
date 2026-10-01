import Link from "next/link";
import * as React from "react";

import { InstrumentButton, StatusPanel, type StatusPanelTone } from "@mystcrag/ui";

import { ERROR_PRESENTATION, type FrontendErrorCode } from "../src/lib/api/frontend-api-error";

type PageScaffoldProps = {
  eyebrow: string;
  title: string;
  description: string;
};

/**
 * Shared content-shell scaffold for intermediate pages. Customer routes render
 * their own page families instead; this stays the neutral shell for anything
 * that has not been migrated to a star page family yet.
 */
export function PageScaffold({ eyebrow, title, description }: PageScaffoldProps) {
  return (
    <main
      className="mx-auto min-h-[calc(100dvh-5rem)] max-w-6xl px-5 py-12 sm:py-20"
      data-atelier-surface="content-shell"
      data-star-surface="content"
    >
      <Surface>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">{eyebrow}</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">{title}</h1>
        <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--muted)] sm:text-lg">{description}</p>
      </Surface>
    </main>
  );
}

// The star shell already paints the paper surface; a plain section keeps the
// scaffold free of the legacy card-in-card treatment.
function Surface({ children }: { children: React.ReactNode }) {
  return <section className="max-w-3xl">{children}</section>;
}

export type SystemStateAction =
  | { kind: "button"; label: string; onAction(): void }
  | { kind: "link"; label: string; href: string };

export type SystemStatePanelProps = Omit<React.HTMLAttributes<HTMLElement>, "title" | "children"> & {
  title: string;
  message: string;
  tone?: StatusPanelTone;
  role?: "status" | "alert";
  busy?: boolean;
  compact?: boolean;
  state?: string;
  action?: SystemStateAction;
};

/**
 * The single presentation primitive for every recoverable or informational
 * state. It delegates to the shared `@mystcrag/ui` status panel, keeps one real
 * next action, and never renders placeholder copy. Retry and
 * navigation stay distinguishable because a retry is a `button` action and a
 * destination is a `link` action.
 */
export function SystemStatePanel({
  title,
  message,
  tone = "info",
  role = "status",
  busy = false,
  compact = false,
  state,
  action,
  className = "",
  ...rest
}: SystemStatePanelProps) {
  const classes = ["star-system-state", compact ? "star-system-state--compact" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <StatusPanel
      {...rest}
      aria-busy={busy ? true : undefined}
      aria-live={busy ? "polite" : undefined}
      className={classes}
      data-star-system-state={state ?? (busy ? "loading" : role)}
      role={role}
      title={title}
      tone={tone}
    >
      <p data-star-system-message="true">{message}</p>
      {action ? (
        <div data-star-system-action="true">
          {action.kind === "link" ? (
            <Link className="star-system-action" data-star-instrument-button="primary" href={action.href}>
              {action.label}
            </Link>
          ) : (
            <InstrumentButton onClick={action.onAction} type="button" variant="primary">
              {action.label}
            </InstrumentButton>
          )}
        </div>
      ) : null}
    </StatusPanel>
  );
}

export type SystemStateKind = "loading" | "error" | "offline" | "empty" | "not-found";

const SYSTEM_STATE_CODE = {
  error: "INTERNAL_ERROR",
  offline: "NETWORK_ERROR",
  empty: "EMPTY_STATE",
  "not-found": "NOT_FOUND"
} as const satisfies Record<Exclude<SystemStateKind, "loading">, FrontendErrorCode>;

const LOADING_COPY = {
  title: "正在准备玄圭星台",
  message: "正在加载内容，请稍候。"
} as const;

/**
 * Canonical copy/tone/role for the five shared system states. Recoverable copy
 * is read straight from the API error presentation table so the state panel and
 * an inline flow notice can never drift apart.
 */
export function systemStateCopy(kind: SystemStateKind): {
  title: string;
  message: string;
  tone: StatusPanelTone;
  role: "status" | "alert";
  busy: boolean;
} {
  if (kind === "loading") {
    return { ...LOADING_COPY, tone: "info", role: "status", busy: true };
  }
  const presentation = ERROR_PRESENTATION[SYSTEM_STATE_CODE[kind]];
  return {
    title: presentation.title,
    message: presentation.message,
    tone: presentation.tone === "neutral" ? "info" : presentation.tone,
    role: presentation.tone === "danger" ? "alert" : "status",
    busy: false
  };
}

export function SystemState({
  kind,
  action,
  title,
  message,
  className = "",
  ...rest
}: Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  kind: SystemStateKind;
  action?: SystemStateAction;
  /**
   * Page-level wording override. The canonical table supplies the default; a route
   * with its own approved localized copy (the 404 page) may override the text while
   * still rendering through this one primitive for frame, role and action floor.
   */
  title?: string;
  message?: string;
}) {
  const copy = systemStateCopy(kind);
  return (
    <SystemStatePanel
      {...rest}
      {...copy}
      action={action}
      className={className}
      message={message ?? copy.message}
      state={kind}
      title={title ?? copy.title}
    />
  );
}