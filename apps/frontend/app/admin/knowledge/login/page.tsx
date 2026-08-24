import { loginAction } from "../../../../src/features/admin-knowledge/actions";
import { isConsoleConfigured } from "../../../../src/features/admin-knowledge/admin-auth";

export const dynamic = "force-dynamic";

export default async function KnowledgeConsoleLoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = isConsoleConfigured();

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
        Knowledge Console
      </p>
      <h2 className="mt-3 text-xl font-semibold">管理员登录</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        输入服务端配置的 Knowledge Admin Key。密钥仅在服务端校验（timing-safe），不会进入浏览器。
      </p>

      {!configured && (
        <p className="mt-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/8 px-4 py-3 text-sm text-[var(--danger)]">
          当前部署未配置 MYSTCRAG_KNOWLEDGE_ADMIN_KEY / KNOWLEDGE_ADMIN_API_KEY，控制台不可用（fail-closed）。
        </p>
      )}

      {error === "invalid" && (
        <p className="mt-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/8 px-4 py-3 text-sm text-[var(--danger)]">
          Admin Key 不正确，请重试。
        </p>
      )}

      <form action={loginAction} className="mt-6 flex flex-col gap-3">
        <label className="text-sm font-medium" htmlFor="admin-key">
          Admin Key
        </label>
        <input
          id="admin-key"
          name="key"
          type="password"
          required
          minLength={16}
          autoComplete="off"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          placeholder="至少 16 位的管理密钥"
        />
        <button
          type="submit"
          disabled={!configured}
          className="mt-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          进入控制台
        </button>
      </form>
    </div>
  );
}
