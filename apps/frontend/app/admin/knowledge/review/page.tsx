import Link from "next/link";

import {
  editRuleAction,
  ruleActionAction
} from "../../../../src/features/admin-knowledge/actions";
import { createKnowledgeAdminClient } from "../../../../src/features/admin-knowledge/admin-api";
import { requireConsoleAccess } from "../../../../src/features/admin-knowledge/page-guard";
import {
  ConsoleSection,
  EmptyState,
  StatCard,
  StatusBadge
} from "../../../../src/features/admin-knowledge/components/console-primitives";
import {
  CLAIM_TYPE_LABELS,
  RULE_STATUS_LABELS,
  claimTypeLabel,
  formatDateTime
} from "../../../../src/features/admin-knowledge/labels";
import type { KnowledgeStatus } from "@mystcrag/design-contract";

export const dynamic = "force-dynamic";

const STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "全部" },
  { value: "NEEDS_REVIEW", label: "待审核" },
  { value: "CONFLICTED", label: "冲突" },
  { value: "VALIDATED", label: "已自动校验" },
  { value: "EXTRACTED", label: "已抽取" },
  { value: "APPROVED", label: "已批准" }
];

const QUEUE_LIMIT = 100;

export default async function KnowledgeConsoleReviewPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireConsoleAccess();
  const { status } = await searchParams;
  const api = createKnowledgeAdminClient();

  const filterStatus =
    status !== undefined && status !== "" ? (status as KnowledgeStatus) : undefined;
  const [queue, conflicts] = await Promise.all([
    api.listReviewQueue({ status: filterStatus, limit: QUEUE_LIMIT }),
    api.listConflicts()
  ]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="当前视图候选" value={queue.total} />
        <StatCard label="冲突组" value={conflicts.groups.length} tone="danger" />
        <StatCard label="审核上限/页" value={QUEUE_LIMIT} hint="按状态筛选后浏览" />
      </div>

      <ConsoleSection
        title="候选审核队列"
        description="完整证据（来源 + 文档 + 抽取句子）逐条可见；写操作全部经现有 Review Service。"
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => {
            const active = (status ?? "") === filter.value;
            const href =
              filter.value === "" ? "/admin/knowledge/review" : `/admin/knowledge/review?status=${filter.value}`;
            return (
              <Link
                key={filter.value || "all"}
                href={href}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  active
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface-soft)] text-[var(--muted)] hover:text-[var(--accent)]"
                }`}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>

        {queue.items.length === 0 && <EmptyState>当前筛选下没有候选规则。</EmptyState>}

        <div className="flex flex-col gap-4">
          {queue.items.map((item) => (
            <article
              key={item.ruleId}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={item.status} label={RULE_STATUS_LABELS[item.status]} />
                <code className="rounded bg-[var(--surface-soft)] px-1.5 py-0.5 text-xs">
                  {item.subject}
                </code>
                <span className="text-sm text-[var(--muted)]">→</span>
                <code className="rounded bg-[var(--surface-soft)] px-1.5 py-0.5 text-xs">
                  {item.relation}
                </code>
                <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent-deep)]">
                  {claimTypeLabel(item.claimType)}
                </span>
                <span className="text-sm tabular-nums text-[var(--muted)]">
                  置信度 {item.confidence.toFixed(2)}
                </span>
                <span className="ml-auto font-mono text-xs text-[var(--muted)]">
                  {item.ruleId}
                </span>
              </div>

              {!item.validation.valid && (
                <p className="mt-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/8 px-3 py-2 text-xs text-[var(--danger)]">
                  校验问题：{item.validation.issues.join("；")}
                </p>
              )}

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    证据（{item.evidence.length}）
                  </p>
                  <ul className="mt-1 flex flex-col gap-2">
                    {item.evidence.map((entry, index) => (
                      <li
                        key={`${item.ruleId}-evidence-${index}`}
                        className="rounded-lg border border-[var(--border)]/70 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{entry.source.name}</span>
                          <span className="text-xs text-[var(--muted)]">
                            权威度 {entry.source.authorityScore.toFixed(2)} ·{" "}
                            {entry.source.reliabilityLevel}
                          </span>
                        </div>
                        {entry.document !== null && (
                          <a
                            href={entry.document.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 block truncate text-xs text-[var(--accent)] underline-offset-2 hover:underline"
                          >
                            {entry.document.title} · {formatDateTime(entry.document.fetchedAt)}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                  {item.extraction !== null && item.extraction.evidence.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-[var(--muted)]">
                        抽取句子（{item.extraction.evidence.length}）
                      </summary>
                      <ul className="mt-1 list-disc pl-4 text-xs leading-5 text-[var(--muted)]">
                        {item.extraction.evidence.map((evidence, index) => (
                          <li key={`${item.ruleId}-sentence-${index}`}>“{evidence.sentence}”</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Payload
                  </p>
                  <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-[var(--surface-soft)] px-3 py-2 text-xs leading-5">
                    {JSON.stringify(item.payload, null, 2)}
                  </pre>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                <form action={ruleActionAction}>
                  <input type="hidden" name="ruleId" value={item.ruleId} />
                  <input type="hidden" name="action" value="approve" />
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--success)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90"
                  >
                    批准
                  </button>
                </form>
                <form action={ruleActionAction}>
                  <input type="hidden" name="ruleId" value={item.ruleId} />
                  <input type="hidden" name="action" value="reject" />
                  <button
                    type="submit"
                    className="rounded-lg border border-[var(--danger)] px-3 py-1.5 text-sm font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10"
                  >
                    拒绝
                  </button>
                </form>
                <form action={ruleActionAction}>
                  <input type="hidden" name="ruleId" value={item.ruleId} />
                  <input type="hidden" name="action" value="supersede" />
                  <button
                    type="submit"
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    合并退役
                  </button>
                </form>
                <details className="w-full sm:w-auto">
                  <summary className="inline-flex cursor-pointer rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
                    编辑
                  </summary>
                  <form
                    action={editRuleAction}
                    className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                  >
                    <input type="hidden" name="ruleId" value={item.ruleId} />
                    <label className="text-xs text-[var(--muted)]" htmlFor={`confidence-${item.ruleId}`}>
                      置信度
                    </label>
                    <input
                      id={`confidence-${item.ruleId}`}
                      name="confidence"
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      defaultValue={item.confidence.toFixed(2)}
                      className="w-20 rounded border border-[var(--border)] px-2 py-1 text-sm"
                    />
                    <label className="text-xs text-[var(--muted)]" htmlFor={`claim-${item.ruleId}`}>
                      声明类型
                    </label>
                    <select
                      id={`claim-${item.ruleId}`}
                      name="claimType"
                      defaultValue={item.claimType ?? "none"}
                      className="rounded border border-[var(--border)] px-2 py-1 text-sm"
                    >
                      <option value="none">未声明</option>
                      {Object.entries(CLAIM_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-lg bg-[var(--accent)] px-3 py-1 text-sm font-medium text-white hover:bg-[var(--accent-deep)]"
                    >
                      保存
                    </button>
                  </form>
                </details>
              </div>
            </article>
          ))}
        </div>
      </ConsoleSection>

      <ConsoleSection
        title="冲突组"
        description="同 subject + relation 下 payload 发散的候选组，供人工裁决。"
      >
        {conflicts.groups.length === 0 && <EmptyState>当前没有冲突组。</EmptyState>}
        <div className="flex flex-col gap-3">
          {conflicts.groups.map((group, index) => (
            <div
              key={`${group.key.subject}-${group.key.relation}-${index}`}
              className="rounded-xl border border-[var(--border)] px-4 py-3"
            >
              <p className="text-sm">
                <code className="rounded bg-[var(--surface-soft)] px-1.5 py-0.5 text-xs">
                  {group.key.subject}
                </code>{" "}
                <span className="text-[var(--muted)]">→</span>{" "}
                <code className="rounded bg-[var(--surface-soft)] px-1.5 py-0.5 text-xs">
                  {group.key.relation}
                </code>{" "}
                <span className="text-xs text-[var(--muted)]">
                  （{group.key.knowledgeType}，{group.rules.length} 条）
                </span>
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {group.rules.map((rule) => (
                  <li
                    key={rule.ruleId}
                    className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]"
                  >
                    <StatusBadge status={rule.status} label={RULE_STATUS_LABELS[rule.status]} />
                    <span className="font-mono">{rule.ruleId}</span>
                    <span className="tabular-nums">置信度 {rule.confidence.toFixed(2)}</span>
                    <code className="truncate">{JSON.stringify(rule.payload)}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </ConsoleSection>
    </>
  );
}
