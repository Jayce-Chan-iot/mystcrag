"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { ListMyDesignsResponse } from "@mystcrag/design-contract";

import { FlowNotice } from "../../../components/flow-notice";
import { designApi } from "../../../lib/api/design-api";
import type { FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import { toFrontendApiError } from "../../../lib/api/frontend-api-error";
import { DiyEmptyWorkbench, diyDesignHref } from "./diy-empty-workbench";

/**
 * `/diy` is the ownership boundary of the DIY path: it shows only the signed-in
 * caller's own designs, or a genuinely empty tray. It never names a design id,
 * because the server resolves the actor from the verified session, and it never
 * creates anything — creating requires the caller's first real bead choice.
 */

export const DIY_ENTRY_PATH = "/diy";

const DIY_LOGIN_HREF = `/auth/login?returnTo=${encodeURIComponent(DIY_ENTRY_PATH)}`;

const RETRYABLE_CODES = new Set<FrontendErrorCode>(["NETWORK_ERROR", "INTERNAL_ERROR"]);

export type DiyHistoryItem = {
  designId: string;
  designName: string;
  beadCount: number;
  status: string;
  updatedAt: string;
  continuable: boolean;
};

export type DiyEntryView =
  | { kind: "loading" }
  | { kind: "error"; code: FrontendErrorCode }
  | { kind: "empty-tray" }
  | { kind: "history"; items: DiyHistoryItem[] };

export function isContinuableDesignStatus(status: string): boolean {
  return status !== "ARCHIVED";
}

export function toDiyHistoryItems(response: ListMyDesignsResponse): DiyHistoryItem[] {
  return [...response.designs]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((entry) => ({
      designId: entry.design.designId,
      designName: entry.design.designName,
      beadCount: entry.design.beads.length,
      status: entry.status,
      updatedAt: entry.updatedAt,
      continuable: isContinuableDesignStatus(entry.status)
    }));
}

/** Reads only the caller's own history; any failure stays an explicit state. */
export async function loadDiyEntryView(
  api: Pick<typeof designApi, "listDesigns"> = designApi
): Promise<DiyEntryView> {
  try {
    const response = await api.listDesigns();
    return response.designs.length === 0 ? { kind: "empty-tray" } : { kind: "history", items: toDiyHistoryItems(response) };
  } catch (error) {
    return { kind: "error", code: toFrontendApiError(error).code };
  }
}

export type DiyHistoryChoiceProps = {
  items: readonly DiyHistoryItem[];
  onNewDesign(): void;
};

export function DiyHistoryChoice({ items, onNewDesign }: DiyHistoryChoiceProps) {
  return (
    <section className="mt-5" data-diy-history-choice="true">
      <h2 className="text-lg font-semibold text-[var(--foreground)]">继续一份已有设计</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">下面只显示你自己的设计。已归档的记录不能继续编辑。</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <li
            className="rounded-2xl border border-[var(--border)] bg-white/90 p-4"
            data-diy-history-item={item.designId}
            data-diy-history-continuable={item.continuable ? "true" : "false"}
            key={item.designId}
          >
            <p className="text-sm font-medium text-[var(--foreground)]">{item.designName}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {item.beadCount} 颗 · {item.continuable ? "可继续编辑" : "已归档"} · {item.updatedAt.slice(0, 10)}
            </p>
            {item.continuable ? (
              <Link
                className="mt-3 inline-flex min-h-11 items-center rounded-full bg-[var(--accent-deep)] px-5 text-sm text-white"
                data-diy-continue-design="true"
                href={diyDesignHref(item.designId)}
              >
                继续设计
              </Link>
            ) : (
              <p className="mt-3 text-xs text-[var(--muted)]" data-diy-archived-note="true">
                已归档，不能继续编辑。
              </p>
            )}
          </li>
        ))}
      </ul>
      <button
        className="mt-5 flex min-h-11 items-center justify-center rounded-full border border-[var(--accent)] bg-white px-5 text-sm text-[var(--accent-deep)]"
        data-diy-new-design="true"
        onClick={onNewDesign}
        type="button"
      >
        新建设计（空托盘）
      </button>
    </section>
  );
}

export type DiyEntryScreenProps = {
  view: DiyEntryView;
  navigate(href: string): void;
  onNewDesign(): void;
  onRetry(): void;
  onDismissAuthRequired(): void;
  authDismissed?: boolean;
};

export function DiyEntryScreen({
  view,
  navigate,
  onNewDesign,
  onRetry,
  onDismissAuthRequired,
  authDismissed = false
}: DiyEntryScreenProps) {
  if (view.kind === "loading") {
    return (
      <main className="mx-auto w-full max-w-[70rem] px-4 py-10" aria-live="polite" data-diy-entry="loading">
        正在读取你的设计…
      </main>
    );
  }

  if (view.kind === "error") {
    if (authDismissed) {
      return (
        <main className="mx-auto w-full max-w-[70rem] px-4 py-10" data-diy-entry="auth-dismissed">
          <FlowNotice code="UNAUTHORIZED" onDismissAuthRequired={onDismissAuthRequired} />
          <Link className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)]" href={DIY_LOGIN_HREF}>
            重新登录以继续
          </Link>
        </main>
      );
    }
    const retryAction = RETRYABLE_CODES.has(view.code)
      ? { kind: "button" as const, label: "重新读取", onAction: onRetry }
      : undefined;
    return (
      <main className="mx-auto w-full max-w-[70rem] px-4 py-10" data-diy-entry="error">
        <FlowNotice code={view.code} action={retryAction} onDismissAuthRequired={onDismissAuthRequired} />
        {retryAction ? (
          <button
            className="mt-4 flex min-h-11 items-center rounded-full border border-[var(--border)] bg-white px-4 text-xs text-[var(--muted)]"
            data-diy-entry-retry="true"
            onClick={onRetry}
            type="button"
          >
            重新读取我的设计
          </button>
        ) : (
          <Link className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)]" href={DIY_ENTRY_PATH}>
            回到 DIY 入口
          </Link>
        )}
      </main>
    );
  }

  if (view.kind === "empty-tray") {
    return (
      <div data-diy-entry="empty-tray">
        <DiyEmptyWorkbench navigate={navigate} />
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[70rem] px-4 pb-24 pt-5 sm:px-5 lg:pb-8" data-diy-entry="history">
      <h1 className="text-xl font-semibold text-[var(--foreground)]">你的 DIY 设计</h1>
      <DiyHistoryChoice items={view.items} onNewDesign={onNewDesign} />
    </main>
  );
}

export function DiyEntry() {
  const router = useRouter();
  const [view, setView] = React.useState<DiyEntryView>({ kind: "loading" });
  const [preferEmptyTray, setPreferEmptyTray] = React.useState(false);
  const [authDismissed, setAuthDismissed] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    void loadDiyEntryView().then((next) => {
      if (active) setView(next);
    });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const navigate = React.useCallback((href: string) => router.push(href), [router]);

  const screenView: DiyEntryView = preferEmptyTray && view.kind !== "loading" ? { kind: "empty-tray" } : view;

  return (
    <DiyEntryScreen
      authDismissed={authDismissed}
      navigate={navigate}
      onDismissAuthRequired={() => setAuthDismissed(true)}
      onNewDesign={() => setPreferEmptyTray(true)}
      onRetry={() => {
        setAuthDismissed(false);
        setReloadToken((current) => current + 1);
      }}
      view={screenView}
    />
  );
}
