"use client";

import Link from "next/link";
import * as React from "react";

import { buildLoginHref } from "../model/auth-actions";
import { fetchSessionSnapshot, resolveAuthPromptMode } from "./session-client";

/**
 * Approved user-facing copy for the authentication-required dialog. Owned here so the
 * dialog is the single consumer of its own wording; the FlowNotice ERROR_PRESENTATION
 * entry for UNAUTHORIZED is a non-rendered fallback only.
 */
export const AUTH_REQUIRED_COPY = {
  title: "登录后继续",
  message: "登录或注册后，你可以保存设计、继续抽牌并同步个人作品。",
  primaryAction: "登录 / 注册",
  secondaryAction: "暂不登录"
} as const;

/**
 * Approved copy for a stale desktop demo identity. The browser may only show launcher
 * restart guidance — never an Auth0 login link, reload, or secret-bearing recovery.
 */
export const DESKTOP_RECOVERY_COPY = {
  title: "本地演示身份需要刷新",
  message: "请保持此页面打开，重新运行桌面的玄矶系统启动脚本。服务重新启动后，再次执行刚才的操作。",
  primaryAction: "我知道了",
  secondaryAction: "暂不处理"
} as const;

export type AuthPromptMode = "checking" | "auth0" | "desktop-recovery";

/**
 * Escape is the only keyboard dismissal; every other key is ignored by the dialog.
 */
export function isDialogDismissKey(key: string): boolean {
  return key === "Escape";
}

/**
 * Focus-trap arithmetic, kept pure so the Node runner can prove wrap-around without a
 * DOM. Returns the focusable index to move to for a Tab/Shift+Tab. `count` is the number
 * of focusable elements; the result always stays in [0, count).
 */
export function nextTabIndex(key: string, shiftKey: boolean, currentIndex: number, count: number): number {
  const delta = shiftKey ? -1 : 1;
  return (((currentIndex + delta) % count) + count) % count;
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled])';

/**
 * Production HTML/browser never binds the desktop token, so an open redirect or script
 * injection could only ever reach a public login endpoint; still we keep the secondary
 * "暂不登录" and primary login link free of any window-derived value in the initial SSR
 * render to avoid a hydration mismatch. See `initialLoginHref`/the mount effect.
 */
export const SERVER_SAFE_LOGIN_HREF = "/auth/login?returnTo=%2F";

/**
 * The login href used by the PRE-hydration render (SSR and first client render). When an
 * explicit `loginHref` prop is supplied it is honoured verbatim; otherwise the fixed
 * server-safe default is used so the server and client produce identical markup.
 */
export function initialLoginHref(loginHref?: string): string {
  return loginHref ?? SERVER_SAFE_LOGIN_HREF;
}

/**
 * Returns keyboard focus to an element. Exported/pure so behavior tests can prove that
 * every dismissal actually restores focus (not just source inspection). Returns `true`
 * when focus was restored.
 */
export function restoreFocusTo(element: unknown): boolean {
  const candidate = element as { focus?: unknown } | null | undefined;
  if (candidate && typeof candidate.focus === "function") {
    (candidate as HTMLElement).focus();
    return true;
  }
  return false;
}

/**
 * Chooses the element to restore focus to on dialog dismissal. An explicit
 * `returnFocusRef.current` always wins over the `document.activeElement` fallback —
 * required when the trigger control is `disabled` during submit and the browser has
 * already dropped focus to `document.body`.
 */
export function resolveReturnFocusTarget(
  returnFocusRef: { current: HTMLElement | null } | null | undefined,
  fallback: HTMLElement | null
): HTMLElement | null {
  return returnFocusRef?.current ?? fallback;
}

/**
 * The single dismissal primitive for the dialog: close it, restore focus to the
 * previously focused trigger element, then run the caller's `onDismiss`. `onDismiss` is
 * deliberately distinct from any business retry — it only ever reveals intent to close.
 */
export function dismissDialog(close: () => void, restoreFrom: unknown, onDismiss?: () => void): void {
  close();
  restoreFocusTo(restoreFrom);
  onDismiss?.();
}

export function AuthRequiredDialog({
  onDismiss,
  loginHref,
  returnFocusRef,
  initialPromptMode
}: {
  onDismiss?: () => void;
  loginHref?: string;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * Deterministic render/testing input only. Production callers omit this prop so the
   * dialog resolves mode from `/auth/session` after mount.
   */
  initialPromptMode?: AuthPromptMode;
}) {
  const [open, setOpen] = React.useState(true);
  const [promptMode, setPromptMode] = React.useState<AuthPromptMode>(
    initialPromptMode ?? "checking"
  );
  const titleId = React.useId();
  const descriptionId = React.useId();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const primaryRef = React.useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);

  // Two-phase login href: the SSR and first client render share the fixed server-safe
  // default (no hydration mismatch); only after mount do we reflect the real location.
  const [clientHref, setClientHref] = React.useState<string | null>(null);
  const href = initialLoginHref(loginHref ?? clientHref ?? undefined);

  // One callback ref for whichever primary control the resolved mode renders
  // (checking button, auth0 Link, or desktop-recovery button). Attaching focuses it.
  const setPrimaryNode = React.useCallback((node: HTMLElement | null) => {
    primaryRef.current = node;
    if (node) {
      node.focus();
    }
  }, []);

  // Capture the element that had focus before the dialog opened and move focus to the
  // primary action. Focus is restored explicitly on dismissal (see `dismiss`) and again
  // as a backup on an actual unmount. An explicit `returnFocusRef` always wins because
  // a disabled trigger (e.g. "进入抽牌" during submit) leaves `document.activeElement`
  // as `document.body`.
  React.useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    primaryRef.current?.focus();
    return () => {
      restoreFocusTo(resolveReturnFocusTarget(returnFocusRef, previouslyFocusedRef.current));
    };
  }, [returnFocusRef]);

  // After hydration, derive returnTo from the real window.location; never on the server.
  // The default SSR/first client render already shares the server-safe href, so this
  // only switches to the true returnTo post-mount — the documented fix for hydration.
  React.useEffect(() => {
    if (loginHref === undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration window.Location sync (hydration-safe returnTo)
      setClientHref(buildLoginHref(window.location));
    }
  }, [loginHref]);

  // Resolve Auth0 vs desktop-recovery from the shared session snapshot. A session-check
  // failure falls back to Auth0, where `/auth/login` keeps server-side fail-closed config.
  React.useEffect(() => {
    if (initialPromptMode !== undefined) return;
    let active = true;
    fetchSessionSnapshot()
      .then((snapshot) => {
        if (active) setPromptMode(resolveAuthPromptMode(snapshot));
      })
      .catch(() => {
        if (active) setPromptMode("auth0");
      });
    return () => {
      active = false;
    };
  }, [initialPromptMode]);

  // When the resolved mode swaps the primary control, re-focus the new node.
  React.useEffect(() => {
    primaryRef.current?.focus();
  }, [promptMode]);

  const dismiss = React.useCallback(() => {
    // Reads the trigger element lazily at dismissal time (never during render) and runs
    // the same dismissal+focus-restore order used by the Button/Escape/mask paths.
    // `returnFocusRef` takes priority over the captured `document.activeElement`.
    dismissDialog(
      () => setOpen(false),
      resolveReturnFocusTarget(returnFocusRef, previouslyFocusedRef.current),
      onDismiss
    );
  }, [onDismiss, returnFocusRef, setOpen]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isDialogDismissKey(event.key)) {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== "Tab") return;
    const container = containerRef.current;
    if (!container) return;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) return;
    const currentIndex = focusables.indexOf(document.activeElement as HTMLElement);
    const base = currentIndex === -1 ? (event.shiftKey ? focusables.length - 1 : 0) : currentIndex;
    event.preventDefault();
    focusables[nextTabIndex(event.key, event.shiftKey, base, focusables.length)]?.focus();
  };

  const isDesktopRecovery = promptMode === "desktop-recovery";
  const title = isDesktopRecovery ? DESKTOP_RECOVERY_COPY.title : AUTH_REQUIRED_COPY.title;
  const message = isDesktopRecovery
    ? DESKTOP_RECOVERY_COPY.message
    : promptMode === "checking"
      ? "正在检查登录方式…"
      : AUTH_REQUIRED_COPY.message;
  const secondaryLabel = isDesktopRecovery
    ? DESKTOP_RECOVERY_COPY.secondaryAction
    : AUTH_REQUIRED_COPY.secondaryAction;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"
      data-auth-required-dialog="true"
      data-auth-prompt-mode={promptMode}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-white p-6"
      >
        <h2 id={titleId} className="text-base font-medium text-[var(--foreground)]">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {message}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            className="min-h-11 flex-1 rounded-xl border border-[var(--border)] px-4 text-sm text-[var(--muted)]"
            onClick={dismiss}
            type="button"
            data-auth-required-secondary="true"
          >
            {secondaryLabel}
          </button>
          {promptMode === "checking" ? (
            <button
              ref={setPrimaryNode}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[var(--accent-deep)] px-4 text-sm font-medium text-white"
              type="button"
              aria-disabled="true"
              data-auth-required-primary="true"
              data-auth-primary-state="checking"
            >
              {AUTH_REQUIRED_COPY.primaryAction}
            </button>
          ) : promptMode === "desktop-recovery" ? (
            <button
              ref={setPrimaryNode}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[var(--accent-deep)] px-4 text-sm font-medium text-white"
              onClick={dismiss}
              type="button"
              data-auth-required-primary="true"
              data-auth-primary-state="desktop-recovery"
            >
              {DESKTOP_RECOVERY_COPY.primaryAction}
            </button>
          ) : (
            <Link
              ref={setPrimaryNode as React.Ref<HTMLAnchorElement>}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[var(--accent-deep)] px-4 text-sm font-medium text-white"
              href={href}
              data-auth-required-primary="true"
              data-auth-primary-state="auth0"
            >
              {AUTH_REQUIRED_COPY.primaryAction}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
