import { createKnowledgeAdminClient } from "../../../../src/features/admin-knowledge/admin-api";
import { requireConsoleAccess } from "../../../../src/features/admin-knowledge/page-guard";
import {
  ConsoleSection,
  EmptyState,
  StatCard,
  StatusBadge
} from "../../../../src/features/admin-knowledge/components/console-primitives";
import { RunsTrendChart } from "../../../../src/features/admin-knowledge/components/charts";
import { formatDateTime } from "../../../../src/features/admin-knowledge/labels";

export const dynamic = "force-dynamic";

const RUN_STATUS_LABELS: Readonly<Record<string, string>> = {
  RUNNING: "运行中",
  COMPLETED: "已完成",
  FAILED: "失败"
};

export default async function KnowledgeConsoleRunsPage() {
  await requireConsoleAccess();
  const api = createKnowledgeAdminClient();
  const runs = await api.listCollectionRuns(50);
  const items = runs.items;

  const latest = items[0];
  const chartData = [...items]
    .reverse()
    .map((run, index) => ({
      run: `#${items.length - index}`,
      documents: run.documentsAdded,
      candidates: run.candidatesInserted,
      needsReview: run.needsReview
    }));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="采集运行总数" value={runs.total} />
        <StatCard
          label="最近一次"
          value={latest === undefined ? "—" : RUN_STATUS_LABELS[latest.status] ?? latest.status}
          hint={latest === undefined ? undefined : formatDateTime(latest.startedAt)}
          tone={
            latest === undefined
              ? "default"
              : latest.status === "COMPLETED"
                ? "success"
                : latest.status === "FAILED"
                  ? "danger"
                  : "warning"
          }
        />
        <StatCard
          label="累计新增文档"
          value={items.reduce((sum, run) => sum + run.documentsAdded, 0)}
        />
        <StatCard
          label="累计新增候选"
          value={items.reduce((sum, run) => sum + run.candidatesInserted, 0)}
          tone="accent"
        />
      </div>

      <ConsoleSection
        title="采集趋势"
        description="每次 knowledge:collect 完成后写入 CollectionRun（轻量持久化）。"
      >
        {chartData.length === 0 ? (
          <EmptyState>尚未执行采集。运行 knowledge:collect 后此处会出现记录。</EmptyState>
        ) : (
          <RunsTrendChart data={chartData} />
        )}
      </ConsoleSection>

      <ConsoleSection
        title="运行记录"
        description="最近 50 次：来源抓取、文档、候选、冲突与错误。"
      >
        {items.length === 0 && <EmptyState>暂无采集记录。</EmptyState>}
        <div className="flex flex-col gap-3">
          {items.map((run) => (
            <article
              key={run.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge
                  status={
                    run.status === "COMPLETED"
                      ? "APPROVED"
                      : run.status === "FAILED"
                        ? "CONFLICTED"
                        : "NEW"
                  }
                  label={RUN_STATUS_LABELS[run.status] ?? run.status}
                />
                <span className="font-mono text-xs text-[var(--muted)]">{run.id}</span>
                <span className="text-xs text-[var(--muted)]">
                  {formatDateTime(run.startedAt)} → {formatDateTime(run.finishedAt)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--muted)] sm:grid-cols-4 lg:grid-cols-7">
                <span>抓取来源：{run.sourcesCrawled}</span>
                <span>新增文档：{run.documentsAdded}</span>
                <span>重复文档：{run.documentDuplicates}</span>
                <span>插入候选：{run.candidatesInserted}</span>
                <span>待审核：{run.needsReview}</span>
                <span>冲突：{run.conflicts}</span>
                <span>错误：{run.errors.length}</span>
              </div>
              {run.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[var(--danger)]">
                    错误详情（{run.errors.length}）
                  </summary>
                  <ul className="mt-1 list-disc pl-4 text-xs leading-5 text-[var(--muted)]">
                    {run.errors.map((error, index) => (
                      <li key={`${run.id}-error-${index}`}>
                        {error.sourceId}：{error.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {run.sourceResults.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[var(--muted)]">
                    分来源结果（{run.sourceResults.length}）
                  </summary>
                  <div className="mt-1 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                          <th className="py-1 pr-3">来源</th>
                          <th className="py-1 pr-3 text-right">新增文档</th>
                          <th className="py-1 pr-3 text-right">重复文档</th>
                          <th className="py-1 pr-3 text-right">插入候选</th>
                          <th className="py-1 pr-3 text-right">互证合并</th>
                          <th className="py-1 text-right">重复候选</th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.sourceResults.map((result, index) => (
                          <tr
                            key={`${run.id}-source-${index}`}
                            className="border-b border-[var(--border)]/60"
                          >
                            <td className="py-1 pr-3">{result.sourceId}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">
                              {result.documentsAdded}
                            </td>
                            <td className="py-1 pr-3 text-right tabular-nums">
                              {result.duplicateDocuments}
                            </td>
                            <td className="py-1 pr-3 text-right tabular-nums">
                              {result.candidatesInserted}
                            </td>
                            <td className="py-1 pr-3 text-right tabular-nums">
                              {result.corroboratedCandidates}
                            </td>
                            <td className="py-1 text-right tabular-nums">
                              {result.duplicateCandidates}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </article>
          ))}
        </div>
      </ConsoleSection>
    </>
  );
}
