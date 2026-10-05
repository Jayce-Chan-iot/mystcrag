import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { DevelopmentModeBadge } from "../src/components/development-mode-badge";
import { LanguageSwitcher } from "../src/components/language-switcher";
import { AuthStatus } from "../src/features/auth/components/auth-status";
import { readDisplayLocale, translate } from "../src/i18n/locale";
import { LocaleProvider, LocalizedText } from "../src/i18n/locale-provider";
import { isOracleFeatureEnabled, isTarotFeatureEnabled } from "../src/lib/api/api-runtime";
import { MobileBottomNav } from "../components/mobile-bottom-nav";
import "./globals.css";
import { getMainNavigation, navigationMessageKey } from "./navigation";

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

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // The display language comes from a validated, non-sensitive cookie so the first
  // paint already matches the shell; the Authing session cookie stays untouched.
  const cookieStore = await cookies();
  const locale = readDisplayLocale((name) => cookieStore.get(name)?.value);
  const navigation = getMainNavigation({
    tarotEnabled: isTarotFeatureEnabled(),
    oracleEnabled: isOracleFeatureEnabled()
  });

  return (
    <html
      data-oracle-nav={isOracleFeatureEnabled() ? "on" : "off"}
      data-scroll-behavior="smooth"
      lang={locale}
    >
      <body>
        <LocaleProvider initialLocale={locale}>
          <header
            className="sticky top-0 z-50 border-b border-[var(--border)]/70 bg-[var(--surface)]/88 backdrop-blur-xl"
            data-atelier-header="true"
            data-star-header="true"
          >
            <nav className="mx-auto flex h-[3.4rem] max-w-7xl items-center justify-between gap-3 px-4 sm:h-[3.75rem] sm:px-8" aria-label={translate(locale, "shell.mainNavigation")}>
              <Link className="inline-flex min-h-11 items-center whitespace-nowrap font-serif text-lg tracking-[0.18em] sm:text-xl" href="/" aria-label="玄矶 Mystcrag 首页">
                玄矶 <span className="text-[0.68em] tracking-[0.24em] text-[var(--muted)]">MYSTCRAG</span>
              </Link>
              <div
                className="hidden max-w-full items-center gap-7 whitespace-nowrap text-sm text-[var(--muted)] lg:flex"
                data-desktop-navigation="true"
              >
                {navigation.map((item) => {
                  const messageKey = navigationMessageKey(item.href);
                  return (
                    <Link className="inline-flex min-h-11 shrink-0 items-center transition-colors duration-300 hover:text-[var(--accent)]" href={item.href} key={item.href}>
                      {messageKey ? (
                        <LocalizedText messageKey={messageKey} fallback={item.label} />
                      ) : (
                        item.label
                      )}
                    </Link>
                  );
                })}
              </div>
              <div className="flex min-w-0 shrink items-center justify-end gap-2" data-header-actions="true">
                <LanguageSwitcher />
                <AuthStatus />
              </div>
            </nav>
          </header>
          <div className="pb-[3.4rem] lg:pb-0" data-content-shell="true" data-star-surface="shell">
            {children}
            <footer
              className="hidden border-t border-[var(--border)] px-5 py-10 text-sm text-[var(--muted)] lg:block"
              data-atelier-footer="true"
              data-star-footer="true"
            >
              <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p><LocalizedText messageKey="footer.tagline" fallback="玄矶 Mystcrag · 让设计承接此刻的感受" /></p>
                <p><LocalizedText messageKey="footer.disclaimer" fallback="文化意象仅作设计灵感，不代表科学功效或确定性结果。" /></p>
              </div>
            </footer>
          </div>
          <DevelopmentModeBadge />
          <MobileBottomNav />
        </LocaleProvider>
      </body>
    </html>
  );
}
