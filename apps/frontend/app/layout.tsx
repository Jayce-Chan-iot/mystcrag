import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DevelopmentModeBadge } from "../src/components/development-mode-badge";
import { AuthStatus } from "../src/features/auth/components/auth-status";
import { isTarotFeatureEnabled } from "../src/lib/api/api-runtime";
import { MobileBottomNav } from "../components/mobile-bottom-nav";
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
        <header className="sticky top-0 z-50 border-b border-[var(--border)]/70 bg-[var(--surface)]/88 backdrop-blur-xl" data-atelier-header="true">
          <nav className="mx-auto flex h-[3.4rem] max-w-7xl items-center justify-between px-5 sm:h-[3.75rem] sm:px-8" aria-label="主导航">
            <Link className="inline-flex min-h-11 items-center whitespace-nowrap font-serif text-lg tracking-[0.18em] sm:text-xl" href="/" aria-label="玄矶 Mystcrag 首页">
              玄矶 <span className="text-[0.68em] tracking-[0.24em] text-[var(--muted)]">MYSTCRAG</span>
            </Link>
            <div
              className="hidden max-w-full items-center gap-7 whitespace-nowrap text-sm text-[var(--muted)] lg:flex"
              data-desktop-navigation="true"
            >
              {navigation.map((item) => (
                <Link className="inline-flex min-h-11 shrink-0 items-center transition-colors duration-300 hover:text-[var(--accent)]" href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
            <AuthStatus />
          </nav>
        </header>
        <div className="pb-[3.4rem] lg:pb-0" data-content-shell="true">
          {children}
          <footer className="hidden border-t border-[var(--border)] px-5 py-10 text-sm text-[var(--muted)] lg:block" data-atelier-footer="true">
            <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>玄矶 Mystcrag · 让设计承接此刻的感受</p>
              <p>文化意象仅作设计灵感，不代表科学功效或确定性结果。</p>
            </div>
          </footer>
        </div>
        <DevelopmentModeBadge />
        <MobileBottomNav />
      </body>
    </html>
  );
}
