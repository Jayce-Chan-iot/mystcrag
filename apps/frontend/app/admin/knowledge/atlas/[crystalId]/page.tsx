import Link from "next/link";
import { notFound } from "next/navigation";

import { createKnowledgeAdminClient } from "../../../../../src/features/admin-knowledge/admin-api";
import { requireConsoleAccess } from "../../../../../src/features/admin-knowledge/page-guard";
import {
  ConsoleSection,
  CoverageBar,
  EmptyState,
  StatCard,
  StatusBadge
} from "../../../../../src/features/admin-knowledge/components/console-primitives";
import {
  RULE_STATUS_LABELS,
  formatPercent
} from "../../../../../src/features/admin-knowledge/labels";

export const dynamic = "force-dynamic";

export default async function KnowledgeConsoleAtlasDetailPage({
  params
}: {
  params: Promise<{ crystalId: string }>;
}) {
  await requireConsoleAccess();
  const { crystalId } = await params;
  const api = createKnowledgeAdminClient();

  let detail;
  try {
    detail = await api.getCrystalAtlasDetail(decodeURIComponent(crystalId));
  } catch {
    notFound();
  }

  const row = detail.row;
  const approvedProperties = detail.properties.filter((item) => item.status === "APPROVED").length;
  const approvedRelations = detail.relations.filter((item) => item.status === "APPROVED").length;

  return (
    <>
      <div className="flex items-center gap-3">
        <Link
          href="/admin/knowledge/atlas"
          className="text-sm text-[var(--accent)] underline-offset-2 hover:underline"
        >
          ← 返回图鉴
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="宝石学完整度"
          value={formatPercent(row.gemologyCompleteness)}
          tone="accent"
        />
        <StatCard label="视觉完整度" value={formatPercent(row.visualCompleteness)} />
        <StatCard label="文化完整度" value={formatPercent(row.culturalCompleteness)} />
        <StatCard
          label="关联规则"
          value={row.associationCount}
          hint={`冲突 ${row.conflictCount}`}
        />
      </div>

      <ConsoleSection
        title={`${row.displayName.zh}（${row.displayName.en}）`}
        description={`identity: ${row.crystalId} · 已批准属性 ${approvedProperties}/${detail.properties.length} · 已批准关联 ${approvedRelations}/${detail.relations.length}`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              宝石学
            </p>
            <div className="mt-1">
              <CoverageBar percentage={row.gemologyCompleteness} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              视觉
            </p>
            <div className="mt-1">
              <CoverageBar percentage={row.visualCompleteness} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              文化象征
            </p>
            <div className="mt-1">
              <CoverageBar percentage={row.culturalCompleteness} />
            </div>
          </div>
        </div>
      </ConsoleSection>

      <ConsoleSection title="属性（Gemology / Visual / Cultural）" description="逐条属性的值、状态、置信度与来源。">
        {detail.properties.length === 0 ? (
          <EmptyState>暂无属性数据。</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-3">属性</th>
                  <th className="py-2 pr-3">值</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3 text-right">置信度</th>
                  <th className="py-2">来源</th>
                </tr>
              </thead>
              <tbody>
                {detail.properties.map((property) => (
                  <tr key={property.ruleId} className="border-b border-[var(--border)]/60">
                    <td className="py-2 pr-3 text-[var(--muted)]">{property.property}</td>
                    <td className="py-2 pr-3 font-medium">{property.value}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge
                        status={property.status}
                        label={RULE_STATUS_LABELS[property.status]}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {property.confidence.toFixed(2)}
                    </td>
                    <td className="py-2 text-xs text-[var(--muted)]">
                      {property.sourceIds.join("、")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ConsoleSection>

      <ConsoleSection title="关联关系（design relations / symbolism / wuxing / zodiac / tarot）">
        {detail.relations.length === 0 ? (
          <EmptyState>暂无关联关系。</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-3">关系</th>
                  <th className="py-2 pr-3">Payload</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3 text-right">置信度</th>
                  <th className="py-2">来源</th>
                </tr>
              </thead>
              <tbody>
                {detail.relations.map((relation) => (
                  <tr key={relation.ruleId} className="border-b border-[var(--border)]/60">
                    <td className="py-2 pr-3">
                      <code className="text-xs">{relation.relation}</code>
                    </td>
                    <td className="py-2 pr-3">
                      <code className="text-xs">{JSON.stringify(relation.payload)}</code>
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge
                        status={relation.status}
                        label={RULE_STATUS_LABELS[relation.status]}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {relation.confidence.toFixed(2)}
                    </td>
                    <td className="py-2 text-xs text-[var(--muted)]">
                      {relation.sourceIds.join("、")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ConsoleSection>

      <ConsoleSection title="证据来源">
        {detail.sources.length === 0 ? (
          <EmptyState>暂无来源引用。</EmptyState>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {detail.sources.map((source) => (
              <li
                key={source.sourceId}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs"
              >
                <span className="font-medium">{source.sourceId}</span>
                <span className="ml-2 text-[var(--muted)]">{source.ruleCount} 条规则</span>
              </li>
            ))}
          </ul>
        )}
      </ConsoleSection>
    </>
  );
}
