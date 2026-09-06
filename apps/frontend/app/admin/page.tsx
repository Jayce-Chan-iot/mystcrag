import * as React from "react";

type AdminEntry = {
  href: string;
  title: string;
  summary: string;
  access: string;
};

/**
 * The two consoles are siblings, never nested: each has its own login, its own
 * cookie and its own key, and this page deliberately reads none of them so it
 * cannot leak which consoles a deployment has configured or authenticated.
 */
const ADMIN_ENTRIES: readonly AdminEntry[] = [
  {
    href: "/admin/knowledge",
    title: "知识管理",
    summary: "水晶知识图谱、数据源覆盖度、候选审核与采集运行记录。",
    access: "知识管理员独立登录"
  },
  {
    href: "/admin/bead-import",
    title: "珠子素材入库",
    summary: "素材归档、分组确认、人工命名与商品草稿、处理质检、人工授权审核与发布。",
    access: "素材管理员独立登录"
  }
];

export default function AdminEntryPage() {
  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Mystcrag Admin</p>
        <h1 id="admin-entry-heading" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          管理后台
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-6 text-[var(--muted)]">
          两个后台并列且彼此独立：各自独立登录，会话 Cookie 与管理密钥互不共享。在其中一个后台登录，不会获得另一个后台的权限。
        </p>
      </div>

      <ul aria-labelledby="admin-entry-heading" className="mt-6 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        {ADMIN_ENTRIES.map((entry) => (
          <li key={entry.href} className="min-w-0">
            <a
              href={entry.href}
              className="flex min-h-11 min-w-0 flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span className="text-base font-semibold tracking-tight">{entry.title}</span>
              <span className="min-w-0 text-sm leading-6 text-[var(--muted)]">{entry.summary}</span>
              <span className="text-xs font-medium text-[var(--accent-deep)]">{entry.access}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
