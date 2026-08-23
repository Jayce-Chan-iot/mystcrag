import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  hint,
  tone = "default"
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "accent" | "warning" | "danger" | "success";
}) {
  const toneClass = {
    default: "text-[var(--foreground)]",
    accent: "text-[var(--accent)]",
    warning: "text-[var(--warning)]",
    danger: "text-[var(--danger)]",
    success: "text-[var(--success)]"
  }[tone];
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint !== undefined && <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone =
    status === "APPROVED" || status === "VALIDATED"
      ? "bg-[var(--success)]/12 text-[var(--success)]"
      : status === "NEEDS_REVIEW" || status === "DISCOVERED" || status === "NEW" || status === "EXTRACTED"
        ? "bg-[var(--warning)]/12 text-[var(--warning)]"
        : status === "CONFLICTED"
          ? "bg-[var(--danger)]/12 text-[var(--danger)]"
          : "bg-[var(--surface-soft)] text-[var(--muted)]";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

export function CoverageBar({ percentage }: { percentage: number }) {
  const clamped = Math.max(0, Math.min(1, percentage));
  const tone =
    clamped >= 1
      ? "bg-[var(--success)]"
      : clamped >= 0.5
        ? "bg-[var(--accent)]"
        : clamped > 0
          ? "bg-[var(--warning)]"
          : "bg-[var(--border)]";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-soft)]" role="presentation">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}

export function ConsoleSection({
  title,
  description,
  actions,
  children
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description !== undefined && (
            <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
          )}
        </div>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">
      {children}
    </p>
  );
}
