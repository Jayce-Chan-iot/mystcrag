export type MainNavigationItem = Readonly<{ href: string; label: string }>;

export type NavigationCapabilityInput = Readonly<{
  tarotEnabled: boolean;
  oracleEnabled: boolean;
}>;

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
