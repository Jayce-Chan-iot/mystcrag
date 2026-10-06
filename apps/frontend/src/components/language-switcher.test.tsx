import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DISPLAY_LOCALE_OPTIONS, type DisplayLocale } from "../i18n/locale";
import {
  INITIAL_LANGUAGE_MENU_STATE,
  LanguageMenuFrame,
  createLanguageSwitchModel,
  reduceLanguageMenu
} from "./language-switcher";

const options = DISPLAY_LOCALE_OPTIONS;

function frameProps(
  props: Partial<Parameters<typeof LanguageMenuFrame>[0]> = {}
): Parameters<typeof LanguageMenuFrame>[0] {
  return {
    currentNativeLabel: "简体中文",
    label: "语言",
    locale: "zh-CN",
    menu: INITIAL_LANGUAGE_MENU_STATE,
    onKey: () => undefined,
    onSelect: () => undefined,
    onToggle: () => undefined,
    options,
    ...props
  };
}

function frameMarkup(
  props: Partial<Parameters<typeof LanguageMenuFrame>[0]> = {}
): string {
  return renderToStaticMarkup(<LanguageMenuFrame {...frameProps(props)} />);
}

function hostElement(
  element: React.ReactNode,
  marker: string,
  expectedValue?: string
): { props: Record<string, unknown> } | null {
  if (typeof element !== "object" || element === null) return null;
  const node = element as { props?: Record<string, unknown> };
  if (node.props && marker in node.props) {
    if (expectedValue === undefined || node.props[marker] === expectedValue) {
      return node as { props: Record<string, unknown> };
    }
  }
  const children = node.props?.children;
  const list = Array.isArray(children) ? children : children === undefined ? [] : [children];
  for (const child of list) {
    const found = hostElement(child, marker, expectedValue);
    if (found) return found;
  }
  return null;
}

test("the closed menu offers one discoverable trigger with an accurate expanded state", () => {
  const markup = frameMarkup();

  assert.match(markup, /data-language-switcher="true"/);
  assert.match(markup, /aria-haspopup="menu"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /min-h-11/, "the language trigger stays a 44px target");
  assert.doesNotMatch(markup, /role="menu"/, "options stay out of the tab order while closed");
});

test("the open menu lists all three languages in their own script", () => {
  const markup = frameMarkup({ menu: { open: true, activeIndex: 1 } });

  assert.match(markup, /role="menu"/);
  for (const nativeLabel of ["简体中文", "繁體中文", "English"]) {
    assert.match(markup, new RegExp(nativeLabel));
  }
  assert.equal((markup.match(/role="menuitemradio"/g) ?? []).length, 3);
  assert.equal(
    (markup.match(/aria-checked="true"/g) ?? []).length,
    1,
    "only the language actually in effect is checked, not the highlighted row"
  );
  assert.match(markup, /data-language-option="zh-TW"[^>]*data-language-active="true"/);
  assert.doesNotMatch(markup, /data-language-option="en-US"[^>]*aria-checked="true"/);
});

test("the trigger stays reachable on a 320px header without a duplicate hamburger", () => {
  const markup = frameMarkup();

  assert.match(markup, /data-language-current-label="true"/);
  assert.doesNotMatch(markup, /hamburger|menu-toggle|data-menu-button/i);
  assert.doesNotMatch(markup, /whitespace-nowrap[^"]*min-w-\[\d{3,}px\]/, "no unbreakable width that could overflow");
});

test("the menu state machine opens, wraps, jumps and closes", () => {
  const opened = reduceLanguageMenu(INITIAL_LANGUAGE_MENU_STATE, { type: "toggle" }, 3);
  assert.deepEqual(opened, { open: true, activeIndex: 0 });

  assert.deepEqual(reduceLanguageMenu(opened, { type: "move", delta: 1 }, 3), { open: true, activeIndex: 1 });
  assert.deepEqual(
    reduceLanguageMenu({ open: true, activeIndex: 2 }, { type: "move", delta: 1 }, 3),
    { open: true, activeIndex: 0 },
    "ArrowDown at the last option wraps to the first"
  );
  assert.deepEqual(
    reduceLanguageMenu({ open: true, activeIndex: 0 }, { type: "move", delta: -1 }, 3),
    { open: true, activeIndex: 2 },
    "ArrowUp at the first option wraps to the last"
  );
  assert.deepEqual(reduceLanguageMenu(opened, { type: "first" }, 3), { open: true, activeIndex: 0 });
  assert.deepEqual(reduceLanguageMenu(opened, { type: "last" }, 3), { open: true, activeIndex: 2 });
  assert.deepEqual(reduceLanguageMenu(opened, { type: "close" }, 3), { open: false, activeIndex: 0 });
  assert.deepEqual(reduceLanguageMenu(opened, { type: "open-at", index: 2 }, 3), { open: true, activeIndex: 2 });
  assert.deepEqual(
    reduceLanguageMenu(opened, { type: "open-at", index: 9 }, 3),
    opened,
    "an index outside the option list is ignored"
  );
});

test("keys drive the menu and Escape hands focus back to the trigger", () => {
  const seen: string[] = [];
  const model = createLanguageSwitchModel({
    locale: "zh-CN",
    options,
    onLocaleChange: (locale) => seen.push(locale)
  });

  assert.equal(model.state.open, false);
  const toggled = model.onKeyDown({ key: "Enter" });
  assert.equal(toggled.open, true, "Enter on the trigger opens the menu");
  const moved = model.onKeyDown({ key: "ArrowDown" });
  assert.equal(moved.activeIndex, 1);
  const ended = model.onKeyDown({ key: "End" });
  assert.equal(ended.activeIndex, 2);
  const escaped = model.onKeyDown({ key: "Escape" });
  assert.equal(escaped.open, false);
  assert.equal(model.focusTarget, "trigger", "focus returns to the trigger so keyboard users are not stranded");
  assert.deepEqual(seen, [], "browsing the menu must not change the language");
});

test("choosing a language reports one intent and closes the menu", () => {
  const changed: DisplayLocale[] = [];
  const model = createLanguageSwitchModel({
    locale: "zh-CN",
    options,
    onLocaleChange: (locale) => changed.push(locale)
  });

  const result = model.select("en-US");

  assert.deepEqual(changed, ["en-US"]);
  assert.equal(result.open, false, "the menu closes after a choice");
  assert.equal(model.focusTarget, "none", "a pointer choice does not steal focus elsewhere");
});

test("re-choosing the current language reports no change at all", () => {
  const model = createLanguageSwitchModel({
    locale: "zh-CN",
    options,
    onLocaleChange: () => {
      throw new Error("the current language must not re-emit a change");
    }
  });

  const result = model.select("zh-CN");

  assert.equal(result.open, false);
});

test("activating an option selects the highlighted one", () => {
  const changed: string[] = [];
  const model = createLanguageSwitchModel({
    locale: "zh-CN",
    options,
    onLocaleChange: (locale) => changed.push(locale)
  });

  model.onKeyDown({ key: "Enter" });
  model.onKeyDown({ key: "ArrowDown" });
  const afterActivate = model.onKeyDown({ key: "Enter" });

  assert.deepEqual(changed, ["zh-TW"]);
  assert.equal(afterActivate.open, false);
});

test("the language layer never routes, reloads or re-reads the page", () => {
  for (const path of [
    "./language-switcher.tsx",
    "../i18n/locale.ts",
    "../i18n/locale-provider.tsx"
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /useRouter|router\.(push|replace)|window\.location|location\.(assign|replace|reload)/, path);
    assert.doesNotMatch(source, /location\.href\s*=/, path);
    assert.doesNotMatch(source, /window\.location\.reload/, path);
  }
});

test("the frame wires its real handlers, not decorative markup", () => {
  const toggled: number[] = [];
  const selected: DisplayLocale[] = [];
  const element = LanguageMenuFrame({
    currentNativeLabel: "简体中文",
    label: "语言",
    locale: "zh-CN",
    menu: { open: true, activeIndex: 2 },
    onKey: () => undefined,
    onSelect: (locale) => selected.push(locale),
    onToggle: () => toggled.push(toggled.length),
    options
  });

  const trigger = hostElement(element, "data-language-switcher");
  assert.ok(trigger, "the trigger must be a host element");
  (trigger.props.onClick as () => void)();
  assert.deepEqual(toggled, [0]);

  const englishOption = hostElement(element, "data-language-option", "en-US");
  assert.ok(englishOption, "the English option must be a host element");
  assert.equal(
    englishOption.props["aria-checked"],
    false,
    "the highlighted row is not the checked row while zh-CN is in effect"
  );
  (englishOption.props.onClick as () => void)();
  assert.deepEqual(selected, ["en-US"], "activating an option reports exactly that locale");

  const chineseOption = hostElement(element, "data-language-option", "zh-CN");
  assert.equal(chineseOption?.props["aria-checked"], true);
});

test("the open menu is addressable and capped to the viewport", () => {
  const markup = frameMarkup({ menu: { open: true, activeIndex: 0 } });
  assert.match(markup, /data-language-menu="true"/);
  assert.match(markup, /w-\[9\.5rem\]/);
  assert.match(markup, /max-w-\[calc\(100vw-1\.5rem\)\]/);
  assert.doesNotMatch(
    markup,
    /min-w-\[9\.5rem\]/,
    "an unshrinkable min-width would win over max-width and overflow the page at 200% zoom"
  );

  const css = readFileSync(new URL("../../app/styles/star-shell.css", import.meta.url), "utf8");
  assert.match(
    css,
    /\[data-star-header\] \[data-language-menu="true"\][\s\S]*?max-width:\s*min\(15rem,\s*calc\(100vw - 1\.5rem\)\)/,
    "the popover can never be wider than a 320px viewport"
  );
});

test("the header row shrinks instead of overflowing a narrow viewport", () => {
  const closed = frameMarkup();
  assert.match(closed, /class="relative min-w-0 shrink" data-language-switcher-root="true"/);

  const layoutSource = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  assert.match(
    layoutSource,
    /className="ml-auto flex flex-wrap items-center justify-end gap-2" data-header-actions="true"/,
    "the header action row must be able to take its own row at 320px"
  );
  assert.doesNotMatch(layoutSource, /className="flex shrink-0 items-center gap-2" data-header-actions="true"/);
});

test("the language control keeps a readable name at phone width instead of hiding or truncating it", () => {
  const closed = frameMarkup();

  assert.doesNotMatch(closed, /class="truncate"/, "an ellipsised language name is not a fix for a narrow header");
  const currentLabel = hostElement(LanguageMenuFrame(frameProps()), "data-language-current-label");
  assert.ok(currentLabel, "the current language name must be rendered");
  assert.doesNotMatch(
    String(currentLabel.props.className),
    /(^|\s)hidden(\s|$)/,
    "hiding the current language name leaves a phone user without an understandable label"
  );
});

test("the header gives the action group its own row instead of forcing one line", () => {
  const layoutSource = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../app/styles/star-shell.css", import.meta.url), "utf8");
  const actionsClass = layoutSource.match(/className="([^"]*)" data-header-actions="true"/)?.[1] ?? "";

  assert.ok(actionsClass.length > 0, "the header action group must be identifiable");
  assert.ok(actionsClass.includes("flex-wrap"), "the action group has to wrap onto its own row at 320px");
  assert.ok(actionsClass.includes("ml-auto"), "the wrapped action row stays aligned to the trailing edge");
  assert.ok(!actionsClass.includes("shrink-0"), "a refusal to shrink is what forced the header past the viewport");

  assert.match(
    css,
    /\[data-desktop-navigation\][^{]*\{[^}]*max-height:\s*80px/,
    "the desktop header keeps its 80px budget"
  );
  assert.match(
    css,
    /@media \(max-width: 639px\)[\s\S]*?\[data-star-header\][^{]*\{[^}]*max-height:\s*none;/,
    "the phone header must grow with its content instead of stopping at a fixed budget"
  );
  assert.doesNotMatch(
    css,
    /@media \(max-width: 639px\)[\s\S]*?\[data-star-header\][^{]*\{[^}]*max-height:\s*\d+px/,
    "a pixel cap on the phone header let the identity row cross its bottom edge"
  );
});
