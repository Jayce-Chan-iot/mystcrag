import * as React from "react";
import type { ComponentProps } from "react";

const NOT_CONFIGURED_MESSAGE = "此部署尚未配置珠子素材管理密钥，暂不可登录。";
const INVALID_MESSAGE = "密钥无效，请重新输入。";

export type AdminLoginFormProps = {
  /** Server Action supplied by the login route; the form itself stays secret-free. */
  action?: ComponentProps<"form">["action"];
  configured: boolean;
  error?: string | null;
};

function alertMessage(configured: boolean, error: string | null | undefined): string | null {
  if (!configured) {
    return NOT_CONFIGURED_MESSAGE;
  }
  return error === "invalid" ? INVALID_MESSAGE : null;
}

/**
 * Presentational login form for the bead import console. It renders no key, no
 * environment name and no configured length: the only server-derived fact it
 * may show is whether this deployment accepts logins at all.
 */
export function AdminLoginForm({ action, configured, error }: AdminLoginFormProps) {
  const message = alertMessage(configured, error);

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
        Bead Asset Import Console
      </p>
      <h2 className="mt-3 text-xl font-semibold tracking-tight">珠子素材入库管理员登录</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        输入服务端配置的素材管理密钥。密钥仅在服务端校验，不会进入浏览器、URL 或日志；
        登录成功后浏览器只保存一个不可逆的会话 Cookie。
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
        <label className="text-sm font-medium" htmlFor="asset-admin-key">
          素材管理密钥
        </label>
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
