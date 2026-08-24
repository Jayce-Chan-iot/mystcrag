export type MainNavigationItem = Readonly<{ href: string; label: string }>;

export function getMainNavigation(tarotEnabled: boolean): MainNavigationItem[] {
  return [
    { href: "/ai-design", label: "AI 设计" },
    ...(tarotEnabled ? [{ href: "/tarot/setup", label: "塔罗引导" }] : []),
    { href: "/diy", label: "DIY 创作" },
    { href: "/gallery", label: "作品画廊" },
    { href: "/#inspiration", label: "设计灵感" }
  ];
}
