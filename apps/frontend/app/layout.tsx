import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { DevelopmentModeBadge } from "../src/components/development-mode-badge";
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
            <Link
              aria-label="个人中心"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full transition hover:opacity-85 lg:hidden"
              href="/profile"
            >
              <Image
                alt=""
                className="h-9 w-9 rounded-full border border-[var(--border)] object-cover"
                height={36}
                priority
                src="/avatars/demo-user.webp"
                width={36}
              />
            </Link>
            <Link
              aria-label="个人中心"
              className="hidden h-11 w-11 items-center justify-center rounded-full text-[var(--muted)] transition hover:text-[var(--accent)] lg:inline-flex"
              href="/profile"
            >
              <svg aria-hidden="true" fill="none" height="22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="22">
                <circle cx="12" cy="8.2" r="3.9" />
                <path d="M4.8 20.2c1-3.4 3.9-5.3 7.2-5.3s6.2 1.9 7.2 5.3" />
              </svg>
            </Link>
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
