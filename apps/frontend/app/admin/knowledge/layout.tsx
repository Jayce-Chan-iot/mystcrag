import Link from "next/link";
import type { ReactNode } from "react";

import { isAdminAuthenticated } from "../../../src/features/admin-knowledge/admin-auth";
import { logoutAction } from "../../../src/features/admin-knowledge/actions";

export const dynamic = "force-dynamic";

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/admin/knowledge", label: "总览" },
  { href: "/admin/knowledge/coverage", label: "覆盖度" },
  { href: "/admin/knowledge/sources", label: "数据源" },
  { href: "/admin/knowledge/review", label: "审核" },
  { href: "/admin/knowledge/atlas", label: "水晶图鉴" },
  { href: "/admin/knowledge/graph", label: "关系图谱" },
  { href: "/admin/knowledge/runs", label: "采集记录" }
];

export default async function KnowledgeConsoleLayout({ children }: { children: ReactNode }) {
  const authed = await isAdminAuthenticated();

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
            Knowledge Console V1
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            知识工作台
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            直连 PostgreSQL 真实数据：覆盖度、数据源产出、候选审核与采集运行记录。
          </p>
        </div>
        {authed && (
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              退出
            </button>
          </form>
        )}
      </div>

      {authed && (
        <nav
          className="mt-6 -mx-1 flex max-w-full items-center gap-1 overflow-x-auto whitespace-nowrap px-1 [scrollbar-width:thin]"
          aria-label="知识工作台导航"
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent-deep)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </main>
  );
}
