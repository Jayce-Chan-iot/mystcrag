"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

type MobileNavItem = {
  href: string;
  label: string;
  match: (pathname: string, hash: string) => boolean;
  icon: React.ReactNode;
};

function HomeIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="24">
      <path d="M3.5 10.5 12 3.75l8.5 6.75" />
      <path d="M5.5 9.5V20a.5.5 0 0 0 .5.5h4v-5.5a2 2 0 0 1 4 0V20.5h4a.5.5 0 0 0 .5-.5V9.5" />
    </svg>
  );
}

function InspirationIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="24">
      <path d="M9.5 17.5h5M10.5 20.5h3" />
      <path d="M12 3.5a6 6 0 0 0-3.4 10.9c.6.5.9 1.1.9 1.8h5c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3.5Z" />
    </svg>
  );
}

function DiyIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="24">
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="6.8" cy="10.2" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9.1" cy="17.1" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="16.3" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="17.9" cy="8.9" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="11.9" cy="6.1" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="24">
      <path d="M12 3.8 14.3 8.5l5.2.8-3.7 3.7.9 5.2-4.7-2.4-4.7 2.4.9-5.2L4.5 9.3l5.2-.8L12 3.8Z" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="24">
      <circle cx="12" cy="8.2" r="3.9" />
      <path d="M4.8 20.2c1-3.4 3.9-5.3 7.2-5.3s6.2 1.9 7.2 5.3" />
    </svg>
  );
}

const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  { href: "/", label: "首页", match: (pathname, hash) => pathname === "/" && hash !== "#inspiration", icon: <HomeIcon /> },
  { href: "/#inspiration", label: "灵感", match: (pathname, hash) => pathname === "/" && hash === "#inspiration", icon: <InspirationIcon /> },
  { href: "/diy", label: "DIY", match: (pathname) => pathname === "/diy" || pathname.startsWith("/diy/"), icon: <DiyIcon /> },
  { href: "/gallery", label: "作品画廊", match: (pathname) => pathname === "/gallery", icon: <GalleryIcon /> },
  { href: "/profile", label: "我的", match: (pathname) => pathname === "/profile", icon: <ProfileIcon /> }
];

function useLocationHash(): string {
  const [hash, setHash] = React.useState("");
  React.useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return hash;
}

export function MobileBottomNav() {
  const pathname = usePathname() ?? "/";
  const hash = useLocationHash();

  return (
    <nav
      aria-label="移动端主导航"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-white/97 backdrop-blur-xl lg:hidden"
      data-mobile-bottom-nav="true"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-5">
        {MOBILE_NAV_ITEMS.map((item) => {
          const active = item.match(pathname, hash);
          return (
            <li key={item.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className="relative flex min-h-[3.4rem] flex-col items-center justify-center gap-0.5 px-1 text-[0.62rem] transition-colors"
                data-nav-active={active ? "true" : "false"}
                href={item.href}
                style={{ color: active ? "var(--accent-deep)" : "var(--muted)" }}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-[calc(50%-0.65rem)] top-0 h-[0.17rem] rounded-b-full transition-opacity"
                  style={{ background: "var(--accent-deep)", opacity: active ? 1 : 0 }}
                />
                {item.icon}
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
