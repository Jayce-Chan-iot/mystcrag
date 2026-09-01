/**
 * AuthStatus presentation model (pure, framework-free).
 *
 * The component (`auth-status.tsx`) is a thin renderer over this view model, so the
 * UX contract (states, aria roles/live regions, accessible labels, returnTo/login/
 * logout actions, touch-target and overflow-bounding class contracts) is fully testable
 * with the repository's existing `node:test` + `tsx` runner — no DOM or component test
 * framework is required or authorized.
 */

export type AuthStatusState = "loading" | "unauthenticated" | "authenticated" | "error";

export type AuthStatusUser = {
  readonly displayName?: string;
  readonly email?: string;
};

export type AuthStatusAction = {
  /** Which session action the control triggers. */
  readonly kind: "login" | "logout";
  /** Visible button text. */
  readonly label: string;
  /** Accessible name (aria-label). */
  readonly ariaLabel: string;
  /** Full class contract for the control, including the mobile touch target. */
  readonly className: string;
};

export type AuthStatusView =
  | { readonly state: "loading"; readonly role: "status"; readonly ariaLive: "polite"; readonly text: string }
  | { readonly state: "error"; readonly role: "alert"; readonly ariaLive: "assertive"; readonly text: string; readonly action: AuthStatusAction }
  | { readonly state: "unauthenticated"; readonly action: AuthStatusAction }
  | {
      readonly state: "authenticated";
      readonly role: "status";
      readonly ariaLive: "polite";
      readonly displayName: string;
      /** Class contract bounding the display name so long values cannot overflow the header. */
      readonly displayNameClassName: string;
      /** Class contract for the shrinking header row itself. */
      readonly rowClassName: string;
      readonly action: AuthStatusAction;
    };

/** Mobile touch target: Tailwind `min-h-11` = 2.75rem = 44px minimum. */
export const TOUCH_TARGET_CLASS = "min-h-11";

export const AUTH_STATUS_CLASSES = {
  loginAction:
    "inline-flex min-h-11 items-center rounded-md px-4 py-2 text-sm font-medium text-[var(--accent-deep)] transition hover:bg-[var(--accent)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2",
  errorAction:
    "inline-flex min-h-11 shrink-0 items-center rounded px-2 underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2",
  logoutAction:
    "inline-flex min-h-11 shrink-0 items-center rounded-md px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--muted)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2",
  /** Long displayName/email must truncate inside bounded widths, never stretch the header. */
  displayName: "min-w-0 max-w-[10rem] truncate text-sm text-[var(--foreground)] sm:max-w-[16rem]",
  row: "flex min-w-0 items-center gap-3",
  loadingRow: "flex items-center gap-2 text-sm text-[var(--muted)]",
  errorRow: "flex min-w-0 items-center gap-2 text-sm text-red-600"
} as const;

/**
 * Display name fallback chain: displayName → email → neutral label. Whitespace-only
 * values are treated as absent.
 */
export function resolveDisplayName(user: AuthStatusUser | null | undefined): string {
  const displayName = user?.displayName?.trim();
  if (displayName) return displayName;
  const email = user?.email?.trim();
  if (email) return email;
  return "用户";
}

/**
 * Resolves the AuthStatus view model for a session status. Pure function of its inputs;
 * every aria role/live region/label in the component comes from here.
 */
export function resolveAuthStatusView(
  state: AuthStatusState,
  user?: AuthStatusUser | null
): AuthStatusView {
  switch (state) {
    case "loading":
      return { state: "loading", role: "status", ariaLive: "polite", text: "加载中..." };
    case "error":
      return {
        state: "error",
        role: "alert",
        ariaLive: "assertive",
        text: "会话错误",
        action: {
          kind: "login",
          label: "重新登录",
          ariaLabel: "重新登录",
          className: AUTH_STATUS_CLASSES.errorAction
        }
      };
    case "unauthenticated":
      return {
        state: "unauthenticated",
        action: {
          kind: "login",
          label: "登录",
          ariaLabel: "登录",
          className: AUTH_STATUS_CLASSES.loginAction
        }
      };
    case "authenticated": {
      const displayName = resolveDisplayName(user);
      return {
        state: "authenticated",
        role: "status",
        ariaLive: "polite",
        displayName,
        displayNameClassName: AUTH_STATUS_CLASSES.displayName,
        rowClassName: AUTH_STATUS_CLASSES.row,
        action: {
          kind: "logout",
          label: "退出",
          ariaLabel: "退出登录",
          className: AUTH_STATUS_CLASSES.logoutAction
        }
      };
    }
  }
}
