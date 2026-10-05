import type { MessageKey } from "../src/i18n/locale";

export type MainNavigationItem = Readonly<{ href: string; label: string }>;

export type NavigationCapabilityInput = Readonly<{
  tarotEnabled: boolean;
  oracleEnabled: boolean;
}>;

// The shell resolves a destination to its shared-copy key instead of widening the
// navigation item shape, so capability gating and the existing contract stay as-is.
const NAVIGATION_MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  "/ai-design": "nav.aiDesign",
  "/oracle": "nav.oracle",
  "/tarot/setup": "nav.tarot",
  "/diy": "nav.diy",
  "/gallery": "nav.gallery"
};

export function navigationMessageKey(href: string): MessageKey | null {
  return NAVIGATION_MESSAGE_KEYS[href] ?? null;
}

export function getMainNavigation({
  tarotEnabled,
  oracleEnabled
}: NavigationCapabilityInput): MainNavigationItem[] {
  return [
    { href: "/ai-design", label: "AI 设计" },
    ...(oracleEnabled ? [{ href: "/oracle", label: "星台问卦" }] : []),
    ...(tarotEnabled ? [{ href: "/tarot/setup", label: "塔罗引导" }] : []),
    { href: "/diy", label: "DIY 创作" },
    { href: "/gallery", label: "作品画廊" }
  ];
}
