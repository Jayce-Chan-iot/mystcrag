import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

const navigation = [
  { href: "/ai-design", label: "AI 设计" },
  { href: "/diy", label: "DIY 创作" },
  { href: "/gallery", label: "设计广场" },
  { href: "/crystal-library", label: "水晶百科" },
  { href: "/profile", label: "用户中心" }
];

export const metadata: Metadata = {
  title: {
    default: "玄矶 Mystcrag",
    template: "%s · 玄矶 Mystcrag"
  },
  description: "AI 驱动的个性化水晶手串设计平台"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="border-b border-[var(--border)] bg-[var(--surface)]/90">
          <nav className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" aria-label="主导航">
            <Link className="text-lg font-semibold tracking-[0.12em]" href="/">
              玄矶 MYSTCRAG
            </Link>
            <div className="flex gap-4 overflow-x-auto text-sm text-[var(--muted)]">
              {navigation.map((item) => (
                <Link className="shrink-0 transition-colors hover:text-[var(--accent)]" href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
