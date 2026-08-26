"use client";

import * as React from "react";
import { useSession } from "../hooks/use-session";

export function AuthStatus() {
  const { status, session, login, logout } = useSession();

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--muted)]" role="status" aria-live="polite">
        <span className="animate-pulse">加载中...</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm text-red-600" role="alert" aria-live="assertive">
        <span className="shrink-0">会话错误</span>
        <button
          type="button"
          onClick={() => login()}
          className="inline-flex min-h-11 shrink-0 items-center rounded px-2 underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2"
          aria-label="重新登录"
        >
          重新登录
        </button>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <button
        type="button"
        onClick={() => login()}
        className="inline-flex min-h-11 items-center rounded-md px-4 py-2 text-sm font-medium text-[var(--accent-deep)] transition hover:bg-[var(--accent)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2"
        aria-label="登录"
      >
        登录
      </button>
    );
  }

  // Authenticated
  const displayName = session?.user?.displayName || session?.user?.email || "用户";
  return (
    <div className="flex min-w-0 items-center gap-3" role="status" aria-live="polite">
      <span className="min-w-0 max-w-[10rem] truncate text-sm text-[var(--foreground)] sm:max-w-[16rem]" title={displayName}>{displayName}</span>
      <button
        type="button"
        onClick={() => logout()}
        className="inline-flex min-h-11 shrink-0 items-center rounded-md px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--muted)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2"
        aria-label="退出登录"
      >
        退出
      </button>
    </div>
  );
}
