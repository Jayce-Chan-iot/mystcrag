import * as React from "react";
import type { ComponentProps } from "react";
import type { AssetAdminLoginMode } from "../admin-auth";

const NOT_CONFIGURED_MESSAGE = "此部署尚未配置珠子素材管理密钥，暂不可登录。";
const INVALID_MESSAGE = "密钥无效，请重新输入。";
const INVALID_LOCAL_CREDENTIALS_MESSAGE = "账号或密码错误，请重新输入。";

export type AdminLoginFormProps = {
  /** Server Action supplied by the login route; the form itself stays secret-free. */
  action?: ComponentProps<"form">["action"];
  configured: boolean;
  error?: string | null;
  mode?: AssetAdminLoginMode;
};

function alertMessage(
  configured: boolean,
  error: string | null | undefined,
  mode: AssetAdminLoginMode
): string | null {
  if (!configured) {
    return NOT_CONFIGURED_MESSAGE;
  }
  return error === "invalid"
    ? mode === "LOCAL_CREDENTIALS"
      ? INVALID_LOCAL_CREDENTIALS_MESSAGE
      : INVALID_MESSAGE
    : null;
}

/**
 * Presentational login form for the bead import console. It renders no key, no
 * environment name and no configured length: the only server-derived fact it
 * may show is whether this deployment accepts logins at all.
 */
export function AdminLoginForm({ action, configured, error, mode = "ADMIN_KEY" }: AdminLoginFormProps) {
  const message = alertMessage(configured, error, mode);
  const localCredentials = mode === "LOCAL_CREDENTIALS";

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
        Bead Asset Import Console
      </p>
      <h2 className="mt-3 text-xl font-semibold tracking-tight">珠子素材入库管理员登录</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        {localCredentials
          ? "使用本机开发账号登录。真实素材管理密钥仍仅由服务端持有；登录成功后浏览器只保存不可逆的会话 Cookie。"
          : "输入服务端配置的素材管理密钥。密钥仅在服务端校验，不会进入浏览器、URL 或日志；登录成功后浏览器只保存一个不可逆的会话 Cookie。"}
      </p>

      {message && (
        <p
          id="asset-admin-key-error"
          role="alert"
          tabIndex={-1}
          className="mt-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/8 px-4 py-3 text-sm text-[var(--danger)]"
        >
          {message}
        </p>
      )}

      <form action={action} className="mt-6 flex flex-col gap-3">
        {localCredentials ? (
          <>
            <label className="text-sm font-medium" htmlFor="asset-admin-username">账号</label>
            <input
              id="asset-admin-username"
              name="username"
              type="text"
              required
              defaultValue="admin"
              autoComplete="username"
              disabled={!configured}
              className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            />
            <label className="text-sm font-medium" htmlFor="asset-admin-password">密码</label>
            <input
              id="asset-admin-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              disabled={!configured}
              aria-describedby={message ? "asset-admin-key-error" : undefined}
              className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </>
        ) : (
          <>
            <label className="text-sm font-medium" htmlFor="asset-admin-key">素材管理密钥</label>
            <input
              id="asset-admin-key"
              name="key"
              type="password"
              required
              minLength={16}
              autoComplete="off"
              disabled={!configured}
              aria-describedby={message ? "asset-admin-key-error" : undefined}
              className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </>
        )}
        <button
          type="submit"
          disabled={!configured}
          className="mt-2 min-h-11 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-deep)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          进入素材入库控制台
        </button>
      </form>

      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        此控制台与知识工作台相互独立，两边的登录状态不共享。
      </p>
    </div>
  );
}
