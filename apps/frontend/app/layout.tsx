import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DevelopmentModeBadge } from "../src/components/development-mode-badge";
import { isTarotFeatureEnabled } from "../src/lib/api/api-runtime";
import "./globals.css";
import { getMainNavigation } from "./navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "玄矶 Mystcrag",
    template: "%s · 玄矶 Mystcrag"
  },
  description: "AI 驱动的个性化水晶手串设计平台",
  icons: {
    icon: "/icon.svg"
  }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const navigation = getMainNavigation(isTarotFeatureEnabled());

  return (
    <html data-scroll-behavior="smooth" lang="zh-CN">
      <body>
        <header className="sticky top-0 z-50 border-b border-[var(--border)]/70 bg-[var(--surface)]/88 backdrop-blur-xl">
          <nav className="mx-auto flex max-w-7xl flex-col px-5 py-2 sm:h-20 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-0" aria-label="主导航">
            <Link className="inline-flex min-h-11 items-center whitespace-nowrap font-serif text-lg tracking-[0.18em] sm:text-xl" href="/" aria-label="玄矶 Mystcrag 首页">
              玄矶 <span className="text-[0.68em] tracking-[0.24em] text-[var(--muted)]">MYSTCRAG</span>
            </Link>
            <div
              className="-mx-1 flex max-w-full items-center gap-4 overflow-x-auto whitespace-nowrap px-1 text-sm text-[var(--muted)] [scrollbar-width:thin] sm:mx-0 sm:gap-7 sm:overflow-visible sm:px-0"
              data-mobile-scroll-navigation="true"
            >
              {navigation.map((item) => (
                <Link className="inline-flex min-h-11 shrink-0 items-center transition-colors duration-300 hover:text-[var(--accent)]" href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        {children}
        <DevelopmentModeBadge />
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
