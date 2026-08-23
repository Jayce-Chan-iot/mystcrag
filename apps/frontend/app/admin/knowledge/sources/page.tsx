import {
  reviewSourceAction,
  setSourceEnabledAction
} from "../../../../src/features/admin-knowledge/actions";
import { createKnowledgeAdminClient } from "../../../../src/features/admin-knowledge/admin-api";
import { requireConsoleAccess } from "../../../../src/features/admin-knowledge/page-guard";
import {
  ConsoleSection,
  EmptyState,
  StatCard,
  StatusBadge
} from "../../../../src/features/admin-knowledge/components/console-primitives";
import { SourceYieldChart } from "../../../../src/features/admin-knowledge/components/charts";
import {
  SOURCE_REVIEW_STATUS_LABELS,
  formatDateTime
} from "../../../../src/features/admin-knowledge/labels";

export const dynamic = "force-dynamic";

function yieldTone(value: number): string {
  return value >= 1
    ? "text-[var(--success)]"
    : value >= 0.5
      ? "text-[var(--accent)]"
      : value > 0
        ? "text-[var(--warning)]"
        : "text-[var(--muted)]";
}

function shortName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}

export default async function KnowledgeConsoleSourcesPage() {
  await requireConsoleAccess();
  const api = createKnowledgeAdminClient();
  const [stats, queue] = await Promise.all([
    api.getSourceStats(),
    api.listSources()
  ]);

  const byId = new Map(queue.items.map((item) => [item.id, item]));
  const merged = stats.items.map((item) => ({
    stats: item,
    source: byId.get(item.sourceId)
  }));

  const chartData = stats.items
    .filter((item) => item.documents > 0 || item.candidateCount > 0)
    .map((item) => ({
      name: shortName(item.name),
      yield: item.yield,
      documents: item.documents
    }))
    .sort((a, b) => b.yield - a.yield)
    .slice(0, 16);

  const totalDocuments = stats.items.reduce((sum, item) => sum + item.documents, 0);
  const totalApprovedRules = stats.items.reduce((sum, item) => sum + item.approvedRuleCount, 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="数据源总数" value={stats.total} />
        <StatCard label="文档总数" value={totalDocuments} />
        <StatCard label="候选规则总数" value={stats.items.reduce((s, i) => s + i.candidateCount, 0)} />
        <StatCard label="已批准规则" value={totalApprovedRules} tone="success" />
      </div>

      <ConsoleSection
        title="数据源产出"
        description="yield = 有效候选 / 文档数。操作复用现有 Admin API，不直接操作数据库。"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="py-2 pr-3">名称</th>
                <th className="py-2 pr-3">类别</th>
                <th className="py-2 pr-3">权威度</th>
                <th className="py-2 pr-3">可信级</th>
                <th className="py-2 pr-3">审核状态</th>
                <th className="py-2 pr-3">启用</th>
                <th className="py-2 pr-3 text-right">文档</th>
                <th className="py-2 pr-3 text-right">候选</th>
                <th className="py-2 pr-3 text-right">已批规则</th>
                <th className="py-2 pr-3 text-right">失败</th>
                <th className="py-2 pr-3 text-right">yield</th>
                <th className="py-2 pr-3">最近抓取</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {merged.map(({ stats: item, source }) => (
                <tr key={item.sourceId} className="border-b border-[var(--border)]/60 align-top">
                  <td className="py-3 pr-3 font-medium">{item.name}</td>
                  <td className="py-3 pr-3 text-[var(--muted)]">{item.sourceCategory}</td>
                  <td className="py-3 pr-3 tabular-nums">{item.authorityScore.toFixed(2)}</td>
                  <td className="py-3 pr-3 text-[var(--muted)]">{item.reliabilityLevel}</td>
                  <td className="py-3 pr-3">
                    <StatusBadge
                      status={item.reviewStatus}
                      label={SOURCE_REVIEW_STATUS_LABELS[item.reviewStatus]}
                    />
                  </td>
                  <td className="py-3 pr-3">
                    <form action={setSourceEnabledAction}>
                      <input type="hidden" name="sourceId" value={item.sourceId} />
                      <input type="hidden" name="enabled" value={item.enabled ? "false" : "true"} />
                      <button
                        type="submit"
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                          item.enabled
                            ? "bg-[var(--success)]/12 text-[var(--success)] hover:bg-[var(--success)]/20"
                            : "bg-[var(--surface-soft)] text-[var(--muted)] hover:bg-[var(--border)]/40"
                        }`}
                      >
                        {item.enabled ? "已启用" : "已停用"}
                      </button>
                    </form>
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums">{item.documents}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{item.candidateCount}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{item.approvedRuleCount}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{item.failureCount}</td>
                  <td className={`py-3 pr-3 text-right tabular-nums ${yieldTone(item.yield)}`}>
                    {item.yield.toFixed(2)}
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap text-xs text-[var(--muted)]">
                    {formatDateTime(item.lastFetch)}
                  </td>
                  <td className="py-3">
                    <div className="flex gap-1">
                      <form action={reviewSourceAction}>
                        <input type="hidden" name="sourceId" value={item.sourceId} />
                        <input type="hidden" name="reviewStatus" value="APPROVED" />
                        <button
                          type="submit"
                          className="rounded-md border border-[var(--success)]/40 px-2 py-1 text-xs text-[var(--success)] transition-colors hover:bg-[var(--success)]/10"
                        >
                          批准
                        </button>
                      </form>
                      <form action={reviewSourceAction}>
                        <input type="hidden" name="sourceId" value={item.sourceId} />
                        <input type="hidden" name="reviewStatus" value="REJECTED" />
                        <button
                          type="submit"
                          className="rounded-md border border-[var(--danger)]/40 px-2 py-1 text-xs text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10"
                        >
                          拒绝
                        </button>
                      </form>
                    </div>
                    {source?.crawlStrategy !== undefined && (
                      <p className="mt-1 text-[10px] text-[var(--muted)]">
                        {source.crawlStrategy.maxPages} 页上限
                        {source.crawlStrategy.seedPaths?.length
                          ? ` · ${source.crawlStrategy.seedPaths.length} 种子`
                          : ""}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {merged.length === 0 && <EmptyState>暂无数据源。</EmptyState>}
        </div>
      </ConsoleSection>

      <ConsoleSection title="数据源 yield 对比" description="有效候选 / 文档（Top 16）。">
        {chartData.length === 0 ? (
          <EmptyState>暂无产出数据。</EmptyState>
        ) : (
          <SourceYieldChart data={chartData} />
        )}
      </ConsoleSection>
    </>
  );
}
