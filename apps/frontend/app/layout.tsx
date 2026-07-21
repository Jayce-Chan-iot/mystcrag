import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

const navigation = [
  { href: "/ai-design", label: "AI 设计" },
  { href: "/diy", label: "DIY 创作" },
  { href: "/#inspiration", label: "设计灵感" }
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
        <header className="sticky top-0 z-50 border-b border-[var(--border)]/70 bg-[var(--surface)]/88 backdrop-blur-xl">
          <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:h-20 sm:px-8" aria-label="主导航">
            <Link className="font-serif text-lg tracking-[0.18em] sm:text-xl" href="/" aria-label="玄矶 Mystcrag 首页">
              玄矶 <span className="text-[0.68em] tracking-[0.24em] text-[var(--muted)]">MYSTCRAG</span>
            </Link>
            <div className="flex items-center gap-4 text-sm text-[var(--muted)] sm:gap-7">
              {navigation.map((item) => (
                <Link className="shrink-0 transition-colors duration-300 hover:text-[var(--accent)]" href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        {children}
        <footer className="border-t border-[var(--border)] px-5 py-10 text-sm text-[var(--muted)]">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>玄矶 Mystcrag · 让设计承接此刻的感受</p>
            <p>文化意象仅作设计灵感，不代表科学功效或确定性结果。</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
