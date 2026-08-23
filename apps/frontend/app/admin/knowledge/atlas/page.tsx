import Link from "next/link";

import { createKnowledgeAdminClient } from "../../../../src/features/admin-knowledge/admin-api";
import { requireConsoleAccess } from "../../../../src/features/admin-knowledge/page-guard";
import {
  ConsoleSection,
  CoverageBar,
  EmptyState
} from "../../../../src/features/admin-knowledge/components/console-primitives";
import { formatPercent } from "../../../../src/features/admin-knowledge/labels";

export const dynamic = "force-dynamic";

export default async function KnowledgeConsoleAtlasPage() {
  await requireConsoleAccess();
  const api = createKnowledgeAdminClient();
  const atlas = await api.getCrystalAtlas();
  const rows = atlas.items;

  const totals = {
    gemology: rows.filter((row) => row.gemologyCompleteness > 0).length,
    visual: rows.filter((row) => row.visualCompleteness > 0).length,
    cultural: rows.filter((row) => row.culturalCompleteness > 0).length
  };

  return (
    <ConsoleSection
      title="水晶图鉴"
      description={`列表版 V1：${rows.length} 种 taxonomy 材料，其中 ${totals.gemology} 种具备宝石学属性、${totals.visual} 种具备视觉特征、${totals.cultural} 种具备文化象征数据。`}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="py-2 pr-3">水晶</th>
              <th className="py-2 pr-3">宝石学完整度</th>
              <th className="py-2 pr-3">视觉完整度</th>
              <th className="py-2 pr-3">文化完整度</th>
              <th className="py-2 pr-3 text-right">关联规则</th>
              <th className="py-2 pr-3 text-right">冲突</th>
              <th className="py-2">详情</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.crystalId} className="border-b border-[var(--border)]/60">
                <td className="py-2 pr-3 font-medium">
                  {row.displayName.zh || row.displayName.en}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <CoverageBar percentage={row.gemologyCompleteness} />
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
                      {formatPercent(row.gemologyCompleteness)}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <CoverageBar percentage={row.visualCompleteness} />
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
                      {formatPercent(row.visualCompleteness)}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <CoverageBar percentage={row.culturalCompleteness} />
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
                      {formatPercent(row.culturalCompleteness)}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{row.associationCount}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {row.conflictCount > 0 ? (
                    <span className="text-[var(--danger)]">{row.conflictCount}</span>
                  ) : (
                    0
                  )}
                </td>
                <td className="py-2">
                  <Link
                    href={`/admin/knowledge/atlas/${encodeURIComponent(row.crystalId)}`}
                    className="text-sm text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    查看
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState>暂无水晶数据。</EmptyState>}
      </div>
    </ConsoleSection>
  );
}
