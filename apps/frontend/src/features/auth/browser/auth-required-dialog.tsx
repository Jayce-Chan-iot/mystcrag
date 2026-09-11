"use client";

import Link from "next/link";
import * as React from "react";

import { buildLoginHref } from "../model/auth-actions";

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

function defaultLoginHref(): string {
  if (typeof window === "undefined") {
    return "/auth/login?returnTo=%2F";
  }
  return buildLoginHref(window.location);
}

export function AuthRequiredDialog({
  onDismiss,
  loginHref
}: {
  onDismiss?: () => void;
  loginHref?: string;
}) {
  const [open, setOpen] = React.useState(true);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const primaryRef = React.useRef<HTMLAnchorElement>(null);

  const href = loginHref ?? defaultLoginHref();

  // Initial focus on the primary action; restore the previously focused element on
  // unmount so a dismissed dialog returns the user to the action that triggered it.
  React.useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    primaryRef.current?.focus();
    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  const dismiss = React.useCallback(() => {
    setOpen(false);
    onDismiss?.();
  }, [onDismiss]);

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

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"
      data-auth-required-dialog="true"
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
          {AUTH_REQUIRED_COPY.title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {AUTH_REQUIRED_COPY.message}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            className="min-h-11 flex-1 rounded-xl border border-[var(--border)] px-4 text-sm text-[var(--muted)]"
            onClick={dismiss}
            type="button"
            data-auth-required-secondary="true"
          >
            {AUTH_REQUIRED_COPY.secondaryAction}
          </button>
          <Link
            ref={primaryRef}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[var(--accent-deep)] px-4 text-sm font-medium text-white"
            href={href}
            data-auth-required-primary="true"
          >
            {AUTH_REQUIRED_COPY.primaryAction}
          </Link>
        </div>
      </div>
    </div>
  );
}