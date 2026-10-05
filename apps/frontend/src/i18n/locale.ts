import { enUS } from "./messages/en-US";
import { zhCN } from "./messages/zh-CN";
import { zhTW } from "./messages/zh-TW";

/**
 * The display locale is a presentation preference only. It is deliberately a
 * separate concept from the `locale` stored on a design or Oracle session (which
 * is fixed at creation time) and from the currency a price is quoted in.
 */
export type DisplayLocale = "zh-CN" | "zh-TW" | "en-US";

export const DISPLAY_LOCALES: readonly DisplayLocale[] = ["zh-CN", "zh-TW", "en-US"];

export const DEFAULT_DISPLAY_LOCALE: DisplayLocale = "zh-CN";

/** Non-sensitive by construction: it holds only one of the three locale tags. */
export const DISPLAY_LOCALE_COOKIE = "mystcrag_locale";

const DISPLAY_LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type DisplayLocaleOption = Readonly<{ locale: DisplayLocale; nativeLabel: string }>;

// Each language is named in its own script and is never translated, so a user who
// cannot read the current language can still find their own.
export const DISPLAY_LOCALE_OPTIONS: readonly DisplayLocaleOption[] = [
  { locale: "zh-CN", nativeLabel: "简体中文" },
  { locale: "zh-TW", nativeLabel: "繁體中文" },
  { locale: "en-US", nativeLabel: "English" }
];

export type MessageKey = keyof typeof zhCN;

export type MessageDictionary = { readonly [Key in MessageKey]: string };

const DICTIONARIES: Record<DisplayLocale, MessageDictionary> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "en-US": enUS
};

export function parseDisplayLocale(value: unknown): DisplayLocale {
  if (typeof value !== "string") return DEFAULT_DISPLAY_LOCALE;
  const trimmed = value.trim();
  for (const locale of DISPLAY_LOCALES) {
    if (locale === trimmed) return locale;
  }
  return DEFAULT_DISPLAY_LOCALE;
}

/** Reads the language preference from whatever cookie store the caller owns. */
export function readDisplayLocale(read: (name: string) => string | undefined): DisplayLocale {
  try {
    return parseDisplayLocale(read(DISPLAY_LOCALE_COOKIE));
  } catch {
    // A browser that blocks cookie access still gets the stable default, and the
    // next render can correct it — never an error page.
    return DEFAULT_DISPLAY_LOCALE;
  }
}

export function serializeDisplayLocaleCookie(locale: DisplayLocale): string {
  return `${DISPLAY_LOCALE_COOKIE}=${locale}; path=/; max-age=${DISPLAY_LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

type DocumentLike = { documentElement?: { lang?: string }; cookie?: string };
type StorageLike = { setItem?(key: string, value: string): void; removeItem?(key: string): void };

export type DisplayLocaleWriteTargets = {
  document?: DocumentLike;
  // Accepted so that a language switch is provably limited to `html lang` plus the
  // display cookie: this module never reads or writes either storage slot, which is
  // what keeps the currency choice, form input and empty tray intact across a switch.
  localStorage?: StorageLike;
  sessionStorage?: StorageLike;
};

export type AppliedDisplayLocale = { htmlLang: DisplayLocale; cookie: string };

export function applyDisplayLocale(
  locale: DisplayLocale,
  targets: DisplayLocaleWriteTargets
): AppliedDisplayLocale {
  const cookie = serializeDisplayLocaleCookie(locale);
  const document = targets.document;
  if (document) {
    if (document.documentElement) document.documentElement.lang = locale;
    document.cookie = cookie;
  }
  return { htmlLang: locale, cookie };
}

function lookup(dictionary: MessageDictionary, key: string): string | undefined {
  return (dictionary as Record<string, string>)[key];
}

export function translate(locale: DisplayLocale, key: MessageKey): string {
  return lookup(DICTIONARIES[locale], key) ?? lookup(DICTIONARIES[DEFAULT_DISPLAY_LOCALE], key) ?? "";
}
