/**
 * One set of control tokens for the bead import admin. Every view imports these
 * instead of restating a class string, so the admin cannot drift into a second
 * design system and a tap target or focus ring is changed in exactly one place.
 * The palette variables come from the existing Mystcrag theme.
 */

export const BUTTON_CLASS =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-deep)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60";

export const SECONDARY_BUTTON_CLASS =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60";

export const DANGER_BUTTON_CLASS =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[var(--danger)]/40 px-3 text-sm font-medium text-[var(--danger)] transition-colors hover:border-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60";

export const CARD_CLASS =
  "flex min-w-0 flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4";

export const SUBCARD_CLASS =
  "flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3";

export const FIELD_CLASS =
  "mt-1 min-h-11 w-full min-w-0 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60";

export const LABEL_CLASS = "block text-sm font-medium";

export const HINT_CLASS = "mt-1 text-sm leading-6 text-[var(--muted)]";

export const PILL_CLASS = "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium";

export const NOTICE_TONE_CLASS: Readonly<Record<"info" | "success" | "warning" | "danger", string>> = {
  info: "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-deep)]",
  success: "border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]",
  warning: "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]",
  danger: "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]"
};

export const NOTICE_CLASS = "rounded-xl border px-4 py-3 text-sm";
