import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveMobileNavigationLabels } from "../../components/mobile-bottom-nav";
import {
  DEFAULT_DISPLAY_LOCALE,
  DISPLAY_LOCALES,
  DISPLAY_LOCALE_COOKIE,
  DISPLAY_LOCALE_OPTIONS,
  applyDisplayLocale,
  parseDisplayLocale,
  readDisplayLocale,
  serializeDisplayLocaleCookie,
  translate
} from "./locale";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LocaleProvider, LocalizedText, createDisplayLocaleController, useDisplayLocale } from "./locale-provider";
import { zhCN } from "./messages/zh-CN";
import { zhTW } from "./messages/zh-TW";
import { enUS } from "./messages/en-US";

const messageKeys = Object.keys(zhCN);

type RecordingDocument = {
  documentElement: { lang: string };
  cookieWrites: string[];
  locationTouches: string[];
};

function fakeDocument(initialLang = "zh-CN"): RecordingDocument {
  const record: RecordingDocument = {
    documentElement: { lang: initialLang },
    cookieWrites: [],
    locationTouches: []
  };
  // Any attempt to navigate or reload the page throws: a language switch must be a
  // pure display change that keeps the current route, form input and DIY tray.
  const hostileLocation = new Proxy({} as Record<string, unknown>, {
    set(_target, property) {
      record.locationTouches.push(String(property));
      throw new Error(`switching language must not touch location.${String(property)}`);
    },
    get(_target, property) {
      if (property === "assign" || property === "reload" || property === "replace") {
        return () => {
          record.locationTouches.push(String(property));
          throw new Error(`switching language must not call location.${String(property)}`);
        };
      }
      return undefined;
    }
  });
  Object.defineProperty(record, "location", { value: hostileLocation });
  Object.defineProperty(record, "cookie", {
    set(value: string) {
      record.cookieWrites.push(value);
    },
    get() {
      return record.cookieWrites.join("; ");
    }
  });
  return record;
}

test("only the three approved display locales are accepted, anything else falls back to Simplified Chinese", () => {
  assert.equal(parseDisplayLocale("zh-CN"), "zh-CN");
  assert.equal(parseDisplayLocale("zh-TW"), "zh-TW");
  assert.equal(parseDisplayLocale("en-US"), "en-US");

  for (const forged of [
    undefined,
    null,
    "",
    "   ",
    "en",
    "zh",
    "zh_CN",
    "en-GB",
    "fr-FR",
    "zh-TW; delete",
    "../etc/passwd",
    "x".repeat(200),
    {},
    [],
    42,
    ["zh-CN"]
  ]) {
    assert.equal(parseDisplayLocale(forged), DEFAULT_DISPLAY_LOCALE, `forged value ${JSON.stringify(forged) ?? "undefined"}`);
  }
});

test("the default is Simplified Chinese and the options stay in their own language", () => {
  assert.equal(DEFAULT_DISPLAY_LOCALE, "zh-CN");
  assert.deepEqual([...DISPLAY_LOCALES], ["zh-CN", "zh-TW", "en-US"]);
  assert.deepEqual(
    DISPLAY_LOCALE_OPTIONS.map((option) => option.nativeLabel),
    ["简体中文", "繁體中文", "English"]
  );
  assert.deepEqual(
    DISPLAY_LOCALE_OPTIONS.map((option) => option.locale),
    [...DISPLAY_LOCALES]
  );
});

test("the language cookie is display-only and carries no session material", () => {
  assert.equal(DISPLAY_LOCALE_COOKIE, "mystcrag_locale");

  const cookie = serializeDisplayLocaleCookie("en-US");
  assert.match(cookie, /^mystcrag_locale=en-US;/);
  assert.match(cookie, /path=\//);
  assert.match(cookie, /max-age=\d{7,}/, "the preference survives a refresh");
  assert.match(cookie, /samesite=lax/i);
  assert.doesNotMatch(cookie, /httponly/i, "the client must be able to write it without a reload");
  for (const forbidden of ["token", "sid", "session", "auth", "actor", "bearer"]) {
    assert.doesNotMatch(cookie.toLowerCase(), new RegExp(forbidden), `the language cookie must not carry ${forbidden}`);
  }
});

test("server render reads the cookie and defaults to Simplified Chinese when it is missing or forged", () => {
  assert.equal(readDisplayLocale(() => undefined), "zh-CN", "no cookie yet");
  assert.equal(readDisplayLocale(() => "zh-TW"), "zh-TW");
  assert.equal(readDisplayLocale(() => "en-US"), "en-US");
  assert.equal(readDisplayLocale(() => "pt-BR"), "zh-CN", "a forged cookie value cannot pick an unapproved locale");
  assert.equal(
    readDisplayLocale(() => {
      throw new Error("storage blocked by the browser");
    }),
    "zh-CN",
    "a browser that blocks storage still renders a stable locale, never an error page"
  );
});

test("applying a locale writes exactly html lang and the display cookie", () => {
  const document = fakeDocument();

  const result = applyDisplayLocale("en-US", { document: document as never });

  assert.equal(result.htmlLang, "en-US");
  assert.equal(document.documentElement.lang, "en-US");
  assert.deepEqual(document.cookieWrites, [serializeDisplayLocaleCookie("en-US")]);
  assert.deepEqual(document.locationTouches, []);
});

test("a language switch never rewrites the currency or the working storage", () => {
  const storageWrites: string[] = [];
  const storage = {
    setItem: (key: string) => {
      storageWrites.push(key);
    },
    removeItem: (key: string) => {
      storageWrites.push(key);
    },
    clear: () => {
      storageWrites.push("*clear*");
    }
  };
  const document = fakeDocument();

  applyDisplayLocale("zh-TW", { document: document as never, localStorage: storage as never, sessionStorage: storage as never });

  assert.deepEqual(storageWrites, [], "switching display language must keep the tray, form input and currency choices");
  assert.equal(document.documentElement.lang, "zh-TW");
});

test("the three dictionaries carry an identical key set", () => {
  assert.deepEqual(Object.keys(zhTW).sort(), [...messageKeys].sort(), "zh-TW must mirror zh-CN");
  assert.deepEqual(Object.keys(enUS).sort(), [...messageKeys].sort(), "en-US must mirror zh-CN");
  assert.ok(messageKeys.length >= 8, "the shared dictionary must actually cover the shell");
});

test("every key resolves to human copy that differs across the three languages", () => {
  for (const key of messageKeys) {
    const zhValue = zhCN[key as keyof typeof zhCN];
    const twValue = zhTW[key as keyof typeof zhTW];
    const enValue = enUS[key as keyof typeof enUS];

    for (const [label, value] of [["zh-CN", zhValue], ["zh-TW", twValue], ["en-US", enValue]] as const) {
      assert.equal(typeof value, "string", `${key} missing in ${label}`);
      assert.ok(value.trim().length > 0, `${key} is blank in ${label}`);
      assert.notEqual(value, key, `${key} must not be filled with its own key in ${label}`);
    }
    assert.notEqual(zhValue, enValue, `${key} must be genuinely translated, not copied`);
    assert.notEqual(
      [zhValue, twValue, enValue].filter((value) => value === enValue).length,
      3,
      `${key} must not fall back to one string for every locale`
    );
  }

  for (const locale of DISPLAY_LOCALES) {
    assert.equal(translate(locale, "nav.diy"), { "zh-CN": zhCN, "zh-TW": zhTW, "en-US": enUS }[locale]["nav.diy"]);
    assert.notEqual(translate(locale, "nav.diy"), "nav.diy");
  }
});

test("traditional and simplified copy stay distinct where the shell already differs", () => {
  // Guards against generating 繁體中文 by mechanically reusing the 简体中文 strings.
  const diverging = messageKeys.filter(
    (key) => zhCN[key as keyof typeof zhCN] !== zhTW[key as keyof typeof zhTW]
  );
  assert.ok(diverging.length >= 3, "at least several shell strings must differ between zh-CN and zh-TW");
});

test("the provider hands the server locale and shared copy to the shell", () => {
  function Probe() {
    const { locale, t } = useDisplayLocale();
    return <p data-locale-probe="true">{`${locale}|${t("nav.diy")}`}</p>;
  }

  const english = renderToStaticMarkup(
    <LocaleProvider initialLocale="en-US">
      <Probe />
    </LocaleProvider>
  );
  assert.match(english, /data-locale-probe="true"/);
  assert.ok(english.includes(`en-US|${enUS["nav.diy"]}`), english);
  assert.ok(!english.includes(`en-US|${zhCN["nav.diy"]}`), "an English session must not keep Simplified Chinese copy");

  const simplified = renderToStaticMarkup(
    <LocaleProvider initialLocale="zh-CN">
      <Probe />
    </LocaleProvider>
  );
  assert.ok(simplified.includes(`zh-CN|${zhCN["nav.diy"]}`), simplified);
});

test("a forged server locale falls back before hydration so the shell never flickers", () => {
  function Probe() {
    const { locale, t } = useDisplayLocale();
    return <p>{`${locale}|${t("nav.diy")}`}</p>;
  }

  const markup = renderToStaticMarkup(
    <LocaleProvider initialLocale="de-DE">
      <Probe />
    </LocaleProvider>
  );
  assert.ok(markup.includes(`zh-CN|${zhCN["nav.diy"]}`), markup);
});

test("LocalizedText resolves shared copy from the dictionary, never the raw key", () => {
  const markup = renderToStaticMarkup(
    <LocaleProvider initialLocale="en-US">
      <LocalizedText messageKey="nav.gallery" fallback="作品画廊" />
    </LocaleProvider>
  );
  assert.ok(markup.includes(enUS["nav.gallery"]), markup);
  assert.ok(!markup.includes("nav.gallery"), markup);
  assert.ok(!markup.includes("作品画廊"), "the Simplified Chinese fallback must not survive the switch");
});

test("an unknown message key keeps the caller's visible fallback instead of printing the key", () => {
  const markup = renderToStaticMarkup(
    <LocaleProvider initialLocale="en-US">
      <LocalizedText messageKey={"nav.not-a-real-key" as never} fallback="DIY 创作" />
    </LocaleProvider>
  );
  assert.ok(markup.includes("DIY 创作"), markup);
  assert.ok(!markup.includes("nav.not-a-real-key"), markup);
});

test("the locale controller writes the preference only when it actually changes", () => {
  const document = fakeDocument();
  const controller = createDisplayLocaleController("zh-CN", { document: document as never });

  const same = controller.set("zh-CN");
  assert.equal(same.applied, null, "re-applying the current language writes nothing");
  assert.deepEqual(document.cookieWrites, []);

  const switched = controller.set("en-US");
  assert.equal(switched.locale, "en-US");
  assert.deepEqual(document.cookieWrites, [serializeDisplayLocaleCookie("en-US")]);
  assert.equal(document.documentElement.lang, "en-US");
  assert.deepEqual(document.locationTouches, []);
});

test("the locale controller rejects a forged target before writing anything", () => {
  const document = fakeDocument();
  const controller = createDisplayLocaleController("zh-CN", { document: document as never });

  const result = controller.set("de-DE" as never);

  assert.equal(result.locale, "zh-CN");
  assert.deepEqual(document.cookieWrites, [], "an unapproved value must not reach html lang or the cookie");
});
// Review repair (2026-10-05): a browser that refuses the preference cookie must
// not strand the customer on the old copy, and the phone tab bar has to follow the
// same language authority as the desktop header.

function blockedCookieDocument(appliedLangs: string[]) {
  return {
    documentElement: {
      get lang() {
        return "zh-CN";
      },
      set lang(value: string) {
        appliedLangs.push(value);
      }
    },
    get cookie() {
      return "";
    },
    set cookie(_value: string) {
      throw new Error("this browser blocks every cookie write");
    }
  };
}

test("a refused cookie write still applies the language for the current session", () => {
  const appliedLangs: string[] = [];

  const result = applyDisplayLocale("en-US", { document: blockedCookieDocument(appliedLangs) as never });

  assert.deepEqual(appliedLangs, ["en-US"], "html lang is set before the cookie is attempted");
  assert.equal(result.htmlLang, "en-US");
  assert.equal(result.cookie, serializeDisplayLocaleCookie("en-US"));
  assert.equal(result.persisted, false, "the caller needs to know the choice is session-only");
});

test("the controller separates the applied language from persistence", () => {
  const appliedLangs: string[] = [];
  const controller = createDisplayLocaleController("zh-CN", {
    document: blockedCookieDocument(appliedLangs) as never
  });

  const result = controller.set("en-US");

  assert.equal(result.locale, "en-US", "the language still changes for this session");
  assert.equal(result.changed, true);
  assert.equal(result.persisted, false);
  assert.deepEqual(appliedLangs, ["en-US"]);
});

test("the provider publishes the language even when persistence is refused", () => {
  const source = readFileSync(new URL("./locale-provider.tsx", import.meta.url), "utf8");

  assert.match(source, /setLocaleState\(result\.locale\)/);
  assert.doesNotMatch(
    source,
    /if \(result\.applied\) setLocaleState|if \(result\.persisted\) setLocaleState|result\.persisted && setLocaleState/,
    "a blocked cookie must not leave the shell rendering the previous language"
  );
});

test("the mobile bottom nav resolves every tab label through the language authority", () => {
  assert.deepEqual(resolveMobileNavigationLabels("zh-CN"), {
    home: "首页",
    oracle: "星台问卦",
    diy: "DIY 创作",
    gallery: "作品画廊",
    profile: "我的"
  });
  assert.deepEqual(resolveMobileNavigationLabels("zh-TW"), {
    home: "首頁",
    oracle: "星台問卦",
    diy: "DIY 創作",
    gallery: "作品畫廊",
    profile: "我的"
  });
  assert.deepEqual(resolveMobileNavigationLabels("en-US"), {
    home: "Home",
    oracle: "Oracle",
    diy: "DIY",
    gallery: "Gallery",
    profile: "Profile"
  });
  assert.deepEqual(
    resolveMobileNavigationLabels("de-DE" as never),
    resolveMobileNavigationLabels("zh-CN"),
    "a forged locale never reaches the tab bar"
  );
});

test("the phone tab bar consumes the resolver and localizes its accessible names", () => {
  const source = readFileSync(new URL("../../components/mobile-bottom-nav.tsx", import.meta.url), "utf8");

  assert.match(source, /resolveMobileNavigationLabels\(/);
  assert.doesNotMatch(source, /aria-label="移动端主导航"/, "the nav name must follow the language too");
  assert.match(source, /shell\.mobileNavigation/);
  assert.match(source, /aria-label=\{label\}/);
  for (const fallback of ["首页", "DIY", "作品画廊", "我的"]) {
    assert.match(source, new RegExp(fallback), "the Simplified Chinese fallback stays declared in the tab table");
  }
});
