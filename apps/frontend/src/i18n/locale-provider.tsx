"use client";

import * as React from "react";

import {
  applyDisplayLocale,
  parseDisplayLocale,
  translate,
  type AppliedDisplayLocale,
  type DisplayLocale,
  type DisplayLocaleWriteTargets,
  type MessageKey
} from "./locale";

/**
 * The single place that decides what a language change writes: `html lang` plus the
 * display cookie, and nothing else. Keeping it outside React lets the write set be
 * tested directly, which is how a switch is proven not to disturb the currency
 * choice, form input or the empty DIY tray.
 */
export type DisplayLocaleChange = {
  locale: DisplayLocale;
  changed: boolean;
  /** False when nothing was written (unchanged) or the browser refused the cookie. */
  persisted: boolean;
  applied: AppliedDisplayLocale | null;
};

export type DisplayLocaleController = {
  readonly locale: DisplayLocale;
  set(next: DisplayLocale, targets?: DisplayLocaleWriteTargets): DisplayLocaleChange;
};

export function createDisplayLocaleController(
  initialLocale: string,
  defaultTargets: DisplayLocaleWriteTargets = {}
): DisplayLocaleController {
  let locale = parseDisplayLocale(initialLocale);
  return {
    get locale() {
      return locale;
    },
    set(next, targets) {
      const resolved = parseDisplayLocale(next);
      const changed = resolved !== locale;
      locale = resolved;
      if (!changed) return { locale: resolved, changed, persisted: true, applied: null };
      const applied = applyDisplayLocale(resolved, targets ?? defaultTargets);
      return { locale: resolved, changed, persisted: applied.persisted, applied };
    }
  };
}

/**
 * The single client authority for the display language. It holds no design,
 * session, currency or cart state, and switching it never navigates: the current
 * route, form input, empty tray and in-progress edits all stay untouched.
 */
export type DisplayLocaleContextValue = {
  locale: DisplayLocale;
  setLocale(next: DisplayLocale): void;
  t(key: MessageKey): string;
};

const DisplayLocaleContext = React.createContext<DisplayLocaleContextValue | null>(null);

export type LocaleProviderProps = {
  /** The SSR-validated cookie value, so the first paint already matches the shell. */
  initialLocale: string;
  children: React.ReactNode;
};

export function LocaleProvider({ initialLocale, children }: LocaleProviderProps) {
  const [locale, setLocaleState] = React.useState<DisplayLocale>(() => parseDisplayLocale(initialLocale));
  const [controller] = React.useState(() =>
    createDisplayLocaleController(initialLocale, typeof document === "undefined" ? {} : { document: document as never })
  );

  const value = React.useMemo<DisplayLocaleContextValue>(
    () => ({
      locale,
      setLocale: (next) => {
        const result = controller.set(next);
        // The language is a session fact first and a cookie second: a browser that
        // refuses the write still gets the new copy and the new html lang.
        if (result.changed) setLocaleState(result.locale);
      },
      t: (key) => translate(locale, key)
    }),
    [controller, locale]
  );

  return <DisplayLocaleContext.Provider value={value}>{children}</DisplayLocaleContext.Provider>;
}

export function useDisplayLocale(): DisplayLocaleContextValue {
  const context = React.useContext(DisplayLocaleContext);
  if (!context) {
    throw new Error("useDisplayLocale must render inside LocaleProvider");
  }
  return context;
}

export type LocalizedTextProps = {
  messageKey: MessageKey;
  /** Shown only when the dictionaries cannot resolve the key at runtime. */
  fallback: string;
};

export function LocalizedText({ messageKey, fallback }: LocalizedTextProps) {
  const { t } = useDisplayLocale();
  const value = t(messageKey);
  return <>{value.length > 0 ? value : fallback}</>;
}
