import Link from "next/link";
import type { ReactNode } from "react";

import { logoutAction } from "../../../src/features/admin-bead-import/actions";
import { isBeadImportConsoleAuthenticated } from "../../../src/features/admin-bead-import/console-access";

export const dynamic = "force-dynamic";

/**
 * Console shell only — never an access gate. The login page must stay
 * reachable, so each guarded page calls `requireBeadImportConsoleAccess`
 * itself.
 */
export default async function BeadImportConsoleLayout({ children }: { children: ReactNode }) {
  const authenticated = await isBeadImportConsoleAuthenticated();

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
            Bead Asset Import Console
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">珠子素材入库</h1>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            独立管理后台：素材归档、分组确认、人工命名与草稿、处理质检、人工授权审核与发布。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            管理入口
          </Link>
          {authenticated && (
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--muted)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                退出
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="mt-6 flex min-w-0 flex-col gap-6">{children}</div>
    </main>
  );
}
