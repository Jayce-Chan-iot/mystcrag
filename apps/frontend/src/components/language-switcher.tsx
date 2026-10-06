"use client";

import * as React from "react";

import {
  DISPLAY_LOCALE_OPTIONS,
  parseDisplayLocale,
  type DisplayLocale,
  type DisplayLocaleOption
} from "../i18n/locale";
import { useDisplayLocale } from "../i18n/locale-provider";

/**
 * The header language menu. It changes only the presentation locale: no route
 * change, no reload, no storage sweep, so an open form, an empty DIY tray or an
 * already selected design all stay exactly as they were.
 */

export type LanguageMenuState = Readonly<{ open: boolean; activeIndex: number }>;

export const INITIAL_LANGUAGE_MENU_STATE: LanguageMenuState = { open: false, activeIndex: 0 };

export type LanguageMenuEvent =
  | { type: "toggle" }
  | { type: "close" }
  | { type: "move"; delta: number }
  | { type: "first" }
  | { type: "last" }
  | { type: "open-at"; index: number };

function clampedIndex(index: number, optionCount: number): number {
  if (optionCount <= 0) return 0;
  return ((index % optionCount) + optionCount) % optionCount;
}

export function reduceLanguageMenu(
  state: LanguageMenuState,
  event: LanguageMenuEvent,
  optionCount: number
): LanguageMenuState {
  switch (event.type) {
    case "toggle":
      return state.open
        ? { open: false, activeIndex: INITIAL_LANGUAGE_MENU_STATE.activeIndex }
        : { open: true, activeIndex: clampedIndex(state.activeIndex, optionCount) };
    case "close":
      return { open: false, activeIndex: INITIAL_LANGUAGE_MENU_STATE.activeIndex };
    case "move":
      return { ...state, activeIndex: clampedIndex(state.activeIndex + event.delta, optionCount) };
    case "first":
      return { ...state, activeIndex: 0 };
    case "last":
      return { ...state, activeIndex: clampedIndex(optionCount - 1, optionCount) };
    case "open-at": {
      if (event.index < 0 || event.index >= optionCount) return state;
      return { ...state, activeIndex: event.index };
    }
  }
}

export type LanguageMenuKey = { key: string };

export type LanguageSwitchModel = {
  readonly state: LanguageMenuState;
  readonly focusTarget: "none" | "trigger";
  onToggle(): LanguageMenuState;
  onKeyDown(event: LanguageMenuKey): LanguageMenuState;
  select(next: DisplayLocale): LanguageMenuState;
};

export type LanguageSwitchModelDeps = {
  locale: DisplayLocale;
  options: readonly DisplayLocaleOption[];
  onLocaleChange(next: DisplayLocale): void;
};

/**
 * The single owner of menu state and of what a selection means. The React
 * container only mirrors `state` and restores focus, so the whole interaction is
 * testable without a DOM library.
 */
export function createLanguageSwitchModel(deps: LanguageSwitchModelDeps): LanguageSwitchModel {
  const optionCount = deps.options.length;
  let state = INITIAL_LANGUAGE_MENU_STATE;
  let focusTarget: "none" | "trigger" = "none";

  const currentOption = (): DisplayLocale => {
    const index = deps.options.findIndex((option) => option.locale === deps.locale);
    return deps.options[index < 0 ? 0 : index]?.locale ?? deps.locale;
  };

  const commit = (next: LanguageMenuState): LanguageMenuState => {
    state = next;
    return state;
  };

  const select = (next: DisplayLocale): LanguageMenuState => {
    // Re-picking the language already in effect must not rewrite the preference.
    if (parseDisplayLocale(next) !== deps.locale) deps.onLocaleChange(next);
    return commit(reduceLanguageMenu(state, { type: "close" }, optionCount));
  };

  return {
    get state() {
      return state;
    },
    get focusTarget() {
      return focusTarget;
    },
    onToggle() {
      return commit(reduceLanguageMenu(state, { type: "toggle" }, optionCount));
    },
    onKeyDown(event) {
      if (!state.open) {
        if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
          const index = Math.max(0, deps.options.findIndex((option) => option.locale === currentOption()));
          return commit({ open: true, activeIndex: clampedIndex(index, optionCount) });
        }
        return state;
      }
      switch (event.key) {
        case "Escape":
          focusTarget = "trigger";
          return commit(reduceLanguageMenu(state, { type: "close" }, optionCount));
        case "Tab":
          return commit(reduceLanguageMenu(state, { type: "close" }, optionCount));
        case "ArrowDown":
          return commit(reduceLanguageMenu(state, { type: "move", delta: 1 }, optionCount));
        case "ArrowUp":
          return commit(reduceLanguageMenu(state, { type: "move", delta: -1 }, optionCount));
        case "Home":
          return commit(reduceLanguageMenu(state, { type: "first" }, optionCount));
        case "End":
          return commit(reduceLanguageMenu(state, { type: "last" }, optionCount));
        case "Enter":
        case " ": {
          const highlighted = deps.options[state.activeIndex];
          const closed = select(highlighted ? highlighted.locale : deps.locale);
          focusTarget = "trigger";
          return closed;
        }
        default:
          return state;
      }
    },
    select
  };
}

export type LanguageMenuFrameProps = {
  /** Accessible name and visible short label of the trigger. */
  label: string;
  /** Native spelling of the language currently in effect. */
  currentNativeLabel: string;
  locale: DisplayLocale;
  menu: LanguageMenuState;
  options: readonly DisplayLocaleOption[];
  menuLabel?: string;
  triggerRef?: React.Ref<HTMLButtonElement>;
  onToggle(): void;
  onSelect(next: DisplayLocale): void;
  onKey(event: LanguageMenuKey): void;
};

/**
 * Hook-free renderer for the menu. The trigger keeps the 44px floor, the native
 * language name collapses below the small breakpoint so a 320px header still fits,
 * and the options stay out of the tab order while the menu is closed.
 */
export function LanguageMenuFrame({
  label,
  currentNativeLabel,
  locale,
  menu,
  options,
  menuLabel,
  triggerRef,
  onToggle,
  onSelect,
  onKey
}: LanguageMenuFrameProps) {
  return (
    <div className="relative min-w-0 shrink" data-language-switcher-root="true">
      <button
        aria-expanded={menu.open}
        aria-haspopup="menu"
        aria-label={label}
        className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-white/85 px-3 text-xs text-[var(--muted)] transition-colors duration-300 hover:border-[var(--accent)] motion-reduce:transition-none"
        data-language-switcher="true"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (["Enter", " ", "ArrowDown", "ArrowUp", "Escape"].includes(event.key)) event.preventDefault();
          onKey(event);
        }}
        ref={triggerRef}
        type="button"
      >
        <span>{label}</span>
        <span data-language-current-label="true" className="text-[var(--foreground)]">
          {currentNativeLabel}
        </span>
        <span aria-hidden="true" className="text-[0.62rem]">
          ▾
        </span>
      </button>

      {menu.open ? (
        <div
          aria-label={menuLabel ?? label}
          className="absolute right-0 top-[calc(100%+0.35rem)] z-[60] flex w-[9.5rem] min-w-0 max-w-[calc(100vw-1.5rem)] flex-col gap-1 rounded-2xl border border-[var(--border)] bg-white/97 p-2 shadow-[0_18px_40px_rgb(28_22_40/0.16)]"
          data-language-menu="true"
          onKeyDown={(event) => {
            if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) {
              event.preventDefault();
            }
            onKey(event);
          }}
          role="menu"
        >
          {options.map((option, index) => (
            <button
              data-language-option={option.locale}
              data-language-active={index === menu.activeIndex ? "true" : "false"}
              aria-checked={option.locale === locale}
              className="flex min-h-11 items-center justify-start rounded-xl px-3 text-left text-sm text-[var(--foreground)] transition-colors duration-200 hover:bg-[var(--accent-soft)] motion-reduce:transition-none"
              key={option.locale}
              onClick={() => onSelect(option.locale)}
              role="menuitemradio"
              tabIndex={-1}
              type="button"
            >
              {option.nativeLabel}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useDisplayLocale();
  const [menu, setMenu] = React.useState<LanguageMenuState>(INITIAL_LANGUAGE_MENU_STATE);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const model = React.useMemo(
    () =>
      createLanguageSwitchModel({
        locale,
        options: DISPLAY_LOCALE_OPTIONS,
        onLocaleChange: (next) => setLocale(next)
      }),
    [locale, setLocale]
  );

  const currentNativeLabel =
    DISPLAY_LOCALE_OPTIONS.find((option) => option.locale === locale)?.nativeLabel ?? "";

  const settle = (next: LanguageMenuState): void => {
    setMenu(next);
    // Escape and keyboard activation hand focus back to the trigger, so a keyboard
    // user is never left on a node that just disappeared.
    if (model.focusTarget === "trigger") triggerRef.current?.focus();
  };

  return (
    <LanguageMenuFrame
      currentNativeLabel={currentNativeLabel}
      label={t("language.label")}
      locale={locale}
      menu={menu}
      menuLabel={t("language.menu")}
      onKey={(event) => settle(model.onKeyDown(event))}
      onSelect={(next) => settle(model.select(next))}
      onToggle={() => settle(model.onToggle())}
      options={DISPLAY_LOCALE_OPTIONS}
      triggerRef={triggerRef}
    />
  );
}
