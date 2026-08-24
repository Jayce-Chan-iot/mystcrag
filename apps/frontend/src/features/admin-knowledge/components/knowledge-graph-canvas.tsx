"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Graph, IElementEvent } from "@antv/g6";
import type {
  KnowledgeAdminGraphEdge,
  KnowledgeAdminGraphNode
} from "@mystcrag/design-contract";

export type KnowledgeGraphCanvasProps = {
  nodes: readonly KnowledgeAdminGraphNode[];
  edges: readonly KnowledgeAdminGraphEdge[];
  status: string;
  depth: number;
};

const DOMAIN_COLORS: Readonly<Record<string, string>> = {
  MATERIAL: "#7c5cbf",
  COLOR: "#d75d8a",
  STYLE: "#3f8f8f",
  WUXING: "#b8860b",
  ZODIAC: "#5b8db8",
  TAROT: "#8f6f4f",
  EMOTION: "#c2783c",
  OTHER: "#8a8a98"
};

const STATUS_BADGE: Readonly<Record<string, string>> = {
  APPROVED: "text-[var(--muted)]",
  NEEDS_REVIEW: "text-[var(--warning)]",
  CONFLICTED: "text-[var(--danger)]"
};

function edgeColor(status: string): string {
  if (status === "CONFLICTED") return "#d64550";
  if (status === "NEEDS_REVIEW") return "#c99305";
  return "#9b8ec4";
}

export function KnowledgeGraphCanvas({
  nodes,
  edges,
  status,
  depth
}: KnowledgeGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<KnowledgeAdminGraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<KnowledgeAdminGraphEdge | null>(null);

  useEffect(() => {
    let disposed = false;
    let graph: Graph | null = null;

    void (async () => {
      const { Graph: G6Graph } = await import("@antv/g6");
      if (disposed || containerRef.current === null) return;

      graph = new G6Graph({
        container: containerRef.current,
        autoFit: "view",
        padding: 24,
        animation: false,
        data: {
          nodes: nodes.map((node) => ({
            id: node.id,
            data: {
              label: node.label,
              domain: node.domain,
              status: node.status
            }
          })),
          edges: edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            data: { relation: edge.relation, status: edge.status }
          }))
        },
        node: {
          style: {
            size: (datum) => {
              const incident = nodes.find((node) => node.id === datum.id)?.metadata.incidentEdges ?? 1;
              return 20 + Math.min(18, incident * 2);
            },
            fill: (datum) => DOMAIN_COLORS[(datum.data as { domain?: string }).domain ?? "OTHER"] ?? DOMAIN_COLORS.OTHER,
            stroke: "#ffffff",
            lineWidth: 1.5,
            labelText: (datum) => (datum.data as { label?: string }).label ?? datum.id,
            labelPlacement: "bottom",
            labelFontSize: 11,
            labelFill: "#4b4b57"
          },
          state: {
            selected: { stroke: "#5f4bb6", lineWidth: 3, halo: true }
          }
        },
        edge: {
          style: {
            stroke: (datum) => edgeColor((datum.data as { status?: string }).status ?? "APPROVED"),
            endArrow: true,
            endArrowSize: 6
          },
          state: {
            selected: { stroke: "#5f4bb6", lineWidth: 2.5 }
          }
        },
        layout: {
          type: "d3-force",
          link: { distance: 90 },
          manyBody: { strength: -160 },
          collide: { radius: 26 }
        },
        behaviors: ["drag-canvas", "zoom-canvas", "drag-element"]
      });

      graph.on("node:click", (event: IElementEvent) => {
        const id = event.target?.id;
        const node = nodes.find((entry) => entry.id === id) ?? null;
        setSelectedNode(node);
        setSelectedEdge(null);
      });
      graph.on("edge:click", (event: IElementEvent) => {
        const id = event.target?.id;
        const edge = edges.find((entry) => entry.id === id) ?? null;
        setSelectedEdge(edge);
        setSelectedNode(null);
      });
      graph.on("canvas:click", () => {
        setSelectedNode(null);
        setSelectedEdge(null);
      });

      graphRef.current = graph;
      await graph.render();
    })();

    return () => {
      disposed = true;
      graph?.destroy();
      graphRef.current = null;
    };
  }, [nodes, edges]);

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim().toLowerCase();
    if (query === "") return;
    const hit =
      nodes.find((node) => node.id.toLowerCase() === query || node.label.toLowerCase() === query) ??
      nodes.find(
        (node) => node.id.toLowerCase().includes(query) || node.label.toLowerCase().includes(query)
      );
    if (hit === undefined) {
      setSearchError(`未找到匹配 “${search.trim()}” 的节点。`);
      return;
    }
    setSearchError(null);
    setSelectedNode(hit);
    setSelectedEdge(null);
    const graph = graphRef.current;
    if (graph !== null) {
      void graph.setElementState(hit.id, ["selected"]).then(() => graph.focusElement(hit.id));
    }
  }

  function expandNeighbors(nodeId: string) {
    const params = new URLSearchParams();
    params.set("node", nodeId);
    params.set("depth", String(Math.min(3, depth + 1)));
    params.set("status", status);
    router.push(`/admin/knowledge/graph?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索节点（紫水晶 / color:purple / amethyst）"
          className="w-72 rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          定位
        </button>
        {searchError !== null && <span className="text-xs text-[var(--danger)]">{searchError}</span>}
      </form>

      <div
        ref={containerRef}
        className="h-[520px] w-full rounded-xl border border-[var(--border)] bg-[var(--card)]"
      />

      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
        <span>节点颜色 = 实体域；</span>
        {Object.entries(DOMAIN_COLORS).map(([domain, color]) => (
          <span key={domain} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            {domain}
          </span>
        ))}
        <span className="ml-2">边颜色 = 状态（紫=APPROVED，黄=NEEDS_REVIEW，红=CONFLICTED）</span>
      </div>

      {selectedNode !== null && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">{selectedNode.label}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{selectedNode.id}</p>
              <p className={`mt-1 text-xs ${STATUS_BADGE[selectedNode.status] ?? ""}`}>
                状态：{selectedNode.status}
                {selectedNode.status !== "APPROVED" && "（非批准数据，仅管理员视图）"}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[var(--muted)]">
                <div>域：{selectedNode.domain}</div>
                <div>关联边：{selectedNode.metadata.incidentEdges}</div>
                <div>属性规则：{selectedNode.metadata.propertyCount}</div>
                <div>Taxonomy 术语：{selectedNode.metadata.isTaxonomyTerm ? "是" : "否"}</div>
              </dl>
              {selectedNode.metadata.knowledgeDomains.length > 0 && (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  知识域：{selectedNode.metadata.knowledgeDomains.join("、")}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => expandNeighbors(selectedNode.id)}
              className="shrink-0 rounded-lg border border-[var(--accent)] px-3 py-1.5 text-xs text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
            >
              展开邻居
            </button>
          </div>
        </div>
      )}

      {selectedEdge !== null && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <p className="font-semibold">
            {selectedEdge.source} <span className="text-[var(--accent)]">—{selectedEdge.relation}→</span>{" "}
            {selectedEdge.target}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[var(--muted)] sm:grid-cols-3">
            <div>relation：{selectedEdge.relation}</div>
            <div>claimType：{selectedEdge.claimType ?? "—"}</div>
            <div>confidence：{selectedEdge.confidence.toFixed(2)}</div>
            <div className={STATUS_BADGE[selectedEdge.status] ?? ""}>
              status：{selectedEdge.status}
              {selectedEdge.status === "CONFLICTED" && "（存在冲突，非确定事实）"}
            </div>
            <div>source count：{selectedEdge.sourceCount}</div>
            <div>evidence：{selectedEdge.evidenceCount}</div>
          </dl>
          <p className="mt-1 break-all text-xs text-[var(--muted)]">rule id：{selectedEdge.id}</p>
        </div>
      )}
    </div>
  );
}
