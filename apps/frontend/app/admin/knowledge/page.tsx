import { publishVersionAction, runReviewPipelineAction } from "../../../src/features/admin-knowledge/actions";
import { createKnowledgeAdminClient } from "../../../src/features/admin-knowledge/admin-api";
import { requireConsoleAccess } from "../../../src/features/admin-knowledge/page-guard";
import {
  ConsoleSection,
  CoverageBar,
  StatCard
} from "../../../src/features/admin-knowledge/components/console-primitives";
import { CoverageChart } from "../../../src/features/admin-knowledge/components/charts";
import {
  coverageDomainLabel,
  formatDateTime,
  formatPercent
} from "../../../src/features/admin-knowledge/labels";

export const dynamic = "force-dynamic";

export default async function KnowledgeConsoleOverviewPage() {
  await requireConsoleAccess();
  const api = createKnowledgeAdminClient();
  const overview = await api.getOverview();
  const coverage = await api.getCoverage();

  const chartData = coverage.domains.map((domain) => ({
    domain: coverageDomainLabel(domain.domain),
    current: domain.current,
    target: domain.target
  }));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="已批准数据源" value={overview.sources.APPROVED} tone="accent" />
        <StatCard label="启用数据源" value={overview.sources.enabled} />
        <StatCard label="文档总数" value={overview.documents} />
        <StatCard
          label="外部候选规则"
          value={overview.externalCandidates}
          hint="bootstrap 语料不计入"
        />
        <StatCard
          label="已批准外部规则"
          value={overview.externalApprovedRules}
          tone="success"
          hint="Batch B KPI 目标 ≥80"
        />
        <StatCard label="待审核" value={overview.rules.NEEDS_REVIEW} tone="warning" />
        <StatCard label="冲突" value={overview.rules.CONFLICTED} tone="danger" />
        <StatCard label="已拒绝" value={overview.rules.REJECTED} />
      </div>

      <ConsoleSection
        title="审核管道"
        description="对抽取候选执行分类（含 §19 双源互证合并），不发布版本。"
        actions={
          <form action={runReviewPipelineAction}>
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-deep)]"
            >
              运行审核管道
            </button>
          </form>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-sm">
          <p>
            新建/已抽取：{overview.rules.NEW + overview.rules.EXTRACTED}
          </p>
          <p>已自动校验：{overview.rules.VALIDATED}</p>
          <p>待审核：{overview.rules.NEEDS_REVIEW}</p>
          <p>冲突：{overview.rules.CONFLICTED}</p>
          <p>已合并：{overview.rules.SUPERSEDED}</p>
        </div>
        <div className="mt-4 flex flex-col gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--muted)]">
            最新版本：
            {overview.latestVersion === null
              ? "尚未发布"
              : `${overview.latestVersion.version}（${overview.latestVersion.ruleCount} 条规则，${formatDateTime(overview.latestVersion.publishedAt)}）`}
          </p>
          <form action={publishVersionAction} className="flex items-center gap-2">
            <input
              name="version"
              required
              pattern="[a-z0-9][a-z0-9.\-_]*"
              placeholder="如 2026-08-v2"
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="rounded-lg border border-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
            >
              发布版本
            </button>
          </form>
        </div>
      </ConsoleSection>

      <ConsoleSection
        title="领域覆盖度"
        description="current / target 来自数据库实时规则 + taxonomy + 目标配置。"
      >
        <div className="mb-4">
          <CoverageChart data={chartData} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="py-2 pr-4">领域</th>
                <th className="py-2 pr-4 text-right">当前</th>
                <th className="py-2 pr-4 text-right">目标</th>
                <th className="py-2 pr-4 text-right">百分比</th>
                <th className="py-2">进度</th>
              </tr>
            </thead>
            <tbody>
              {coverage.domains.map((domain) => (
                <tr key={domain.domain} className="border-b border-[var(--border)]/60">
                  <td className="py-2 pr-4">{coverageDomainLabel(domain.domain)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{domain.current}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{domain.target}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPercent(domain.percentage)}
                  </td>
                  <td className="py-2">
                    <CoverageBar percentage={domain.percentage} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ConsoleSection>
    </>
  );
}
