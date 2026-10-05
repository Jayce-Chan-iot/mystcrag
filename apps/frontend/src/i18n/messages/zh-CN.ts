/**
 * The only shared static copy dictionary. Its key set defines `MessageKey`, so the
 * other two locales are checked against it by the compiler as well as by tests.
 * Dynamic projections (Oracle/Tarot stories, design names, server errors) never
 * read from this file — they stay server-owned.
 */
export const zhCN = {
  "nav.aiDesign": "AI 设计",
  "nav.home": "首页",
  "nav.oracle": "星台问卦",
  "nav.tarot": "塔罗引导",
  "nav.diy": "DIY 创作",
  "nav.gallery": "作品画廊",
  "nav.profile": "我的",
  "shell.mainNavigation": "主导航",
  "shell.mobileNavigation": "移动端主导航",
  "footer.tagline": "玄矶 Mystcrag · 让设计承接此刻的感受",
  "footer.disclaimer": "文化意象仅作设计灵感，不代表科学功效或确定性结果。",
  "language.label": "语言",
  "language.trigger": "切换显示语言",
  "language.menu": "选择显示语言"
} as const;
