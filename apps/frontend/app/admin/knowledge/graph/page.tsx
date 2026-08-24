import { createKnowledgeAdminClient } from "../../../../src/features/admin-knowledge/admin-api";
import { requireConsoleAccess } from "../../../../src/features/admin-knowledge/page-guard";
import {
  ConsoleSection,
  EmptyState
} from "../../../../src/features/admin-knowledge/components/console-primitives";
import { KnowledgeGraphCanvas } from "../../../../src/features/admin-knowledge/components/knowledge-graph-canvas";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = ["APPROVED", "NEEDS_REVIEW", "CONFLICTED"] as const;
const DOMAIN_OPTIONS = [
  "MATERIAL",
  "COLOR",
  "STYLE",
  "WUXING",
  "ZODIAC",
  "TAROT",
  "EMOTION",
  "OTHER"
] as const;

function parseStatus(raw: string | undefined): (typeof STATUS_OPTIONS)[number] {
  return STATUS_OPTIONS.find((option) => option === raw) ?? "APPROVED";
}

function parseDomain(raw: string | undefined): string | undefined {
  return DOMAIN_OPTIONS.find((option) => option === raw);
}

function parseBoundedNumber(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export default async function KnowledgeGraphPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireConsoleAccess();
  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const status = parseStatus(single("status"));
  const domain = parseDomain(single("domain"));
  const focusNode = single("node") ?? undefined;
  const depth = parseBoundedNumber(single("depth"), focusNode ? 1 : 1, 1, 3);
  const limit = parseBoundedNumber(single("limit"), 500, 1, 2000);
  const includeSynthetic = single("includeSynthetic") === "true";

  const api = createKnowledgeAdminClient();
  const graph = await api.getKnowledgeGraph({
    node: focusNode,
    domain,
    status,
    depth,
    limit,
    includeSynthetic
  });

  const summary = [
    `节点 ${graph.nodes.length}`,
    `关系边 ${graph.edges.length}`,
    `参与规则 ${graph.stats.rulesConsidered}`
  ];
  if (graph.stats.truncated) {
    summary.push(`已按 limit=${limit} 截断`);
  }

  return (
    <ConsoleSection
      title="知识关系图谱"
      description={`PostgreSQL → Graph API → AntV G6。默认仅显示 APPROVED；切换状态会明确标注非批准数据。${summary.join(" · ")}`}
    >
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">状态</span>
          <select
            name="status"
            defaultValue={status}
            className={`rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 ${
              status === "CONFLICTED"
                ? "text-[var(--danger)]"
                : status === "NEEDS_REVIEW"
                  ? "text-[var(--warning)]"
                  : ""
            }`}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
                {option === "CONFLICTED" ? "（冲突数据）" : option === "NEEDS_REVIEW" ? "（待审）" : "（默认）"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">实体域</span>
          <select
            name="domain"
            defaultValue={domain ?? ""}
            className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5"
          >
            <option value="">全部</option>
            {DOMAIN_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">聚焦节点（可选）</span>
          <input
            name="node"
            defaultValue={focusNode ?? ""}
            placeholder="material:amethyst"
            className="w-48 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">展开深度</span>
          <select
            name="depth"
            defaultValue={String(depth)}
            className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5"
          >
            <option value="1">1 跳</option>
            <option value="2">2 跳</option>
            <option value="3">3 跳</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">边数上限</span>
          <input
            name="limit"
            type="number"
            min={1}
            max={2000}
            defaultValue={limit}
            className="w-24 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5"
          />
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-xs text-[var(--muted)]">
          <input type="checkbox" name="includeSynthetic" value="true" defaultChecked={includeSynthetic} />
          含基准合成数据
        </label>
        <button
          type="submit"
          className="rounded-lg border border-[var(--accent)] px-3 py-1.5 text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
        >
          应用过滤
        </button>
      </form>

      {graph.stats.relations.length > 0 && (
        <p className="text-xs text-[var(--muted)]">
          关系分布：{graph.stats.relations.map((entry) => `${entry.relation} ×${entry.count}`).join("，")}
        </p>
      )}

      {graph.nodes.length === 0 ? (
        <EmptyState>
          当前过滤条件下没有可展示的关系图。真实采集完成后，APPROVED 关系会出现在这里；如需排查数据可勾选“含基准合成数据”。
        </EmptyState>
      ) : (
        <KnowledgeGraphCanvas
          nodes={graph.nodes}
          edges={graph.edges}
          status={status}
          depth={depth}
        />
      )}
    </ConsoleSection>
  );
}
