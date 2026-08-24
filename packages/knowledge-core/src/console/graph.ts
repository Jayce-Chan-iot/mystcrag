import type { StoredKnowledgeRule } from "@mystcrag/database";
import { getTaxonomyTerm } from "@mystcrag/design-contract";

/**
 * Knowledge graph projection over stored rules (task book §26). Rules already
 * carry subject / relation / object triples, so the graph is a pure projection:
 * PostgreSQL → Graph API → G6. No graph database is introduced.
 */

export type ConsoleGraphQuery = {
  focusNode?: string | undefined;
  domain?: string | undefined;
  status?: string | undefined;
  claimType?: string | undefined;
  depth?: number | undefined;
  limit?: number | undefined;
  includeSynthetic?: boolean | undefined;
};

export type ConsoleGraphNode = {
  id: string;
  label: string;
  domain: string;
  status: "APPROVED" | "NEEDS_REVIEW" | "CONFLICTED";
  metadata: {
    isTaxonomyTerm: boolean;
    incidentEdges: number;
    propertyCount: number;
    knowledgeDomains: string[];
  };
};

export type ConsoleGraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
  claimType: string | null;
  confidence: number;
  status: string;
  sourceCount: number;
  evidenceCount: number;
};

export type ConsoleGraph = {
  nodes: ConsoleGraphNode[];
  edges: ConsoleGraphEdge[];
  stats: {
    rulesConsidered: number;
    edgesIncluded: number;
    truncated: boolean;
    relations: Array<{ relation: string; count: number }>;
  };
};

const DEFAULT_STATUS = "APPROVED";
const DEFAULT_DEPTH = 1;
const DEFAULT_LIMIT = 500;

const NODE_DOMAINS = new Set([
  "MATERIAL",
  "COLOR",
  "STYLE",
  "WUXING",
  "ZODIAC",
  "TAROT",
  "EMOTION"
]);

/**
 * Benchmark fixtures (`material:bench-1`, numeric topic stubs) are load-test
 * data, not knowledge. They stay hidden unless explicitly requested.
 */
function isSyntheticId(id: string): boolean {
  return id.includes(":bench-") || /^\d+$/.test(id);
}

function domainOf(id: string): string {
  const term = getTaxonomyTerm(id);
  if (term !== null) return term.domain;
  const prefix = id.includes(":") ? id.slice(0, id.indexOf(":")).toUpperCase() : "";
  return NODE_DOMAINS.has(prefix) ? prefix : "OTHER";
}

function labelOf(id: string): string {
  const term = getTaxonomyTerm(id);
  if (term !== null) return term.displayName.zh || term.displayName.en || id;
  return id;
}

/**
 * Relation payloads are not uniform across extraction layers: extracted
 * candidates use `{ topic }`, color-theory fixtures use `companionColors`,
 * and the corpus bootstrap uses `companions`. All three spell the graph edge
 * target the same way: a taxonomy id (or topic id) string.
 */
function relationTargets(rule: StoredKnowledgeRule): string[] {
  const payload = rule.payload as {
    topic?: unknown;
    companionColors?: unknown;
    companions?: unknown;
  };
  const candidates = [
    ...(typeof payload.topic === "string" ? [payload.topic] : []),
    ...(Array.isArray(payload.companionColors) ? payload.companionColors : []),
    ...(Array.isArray(payload.companions) ? payload.companions : [])
  ];
  return candidates.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function toEdges(rule: StoredKnowledgeRule, targets: readonly string[]): ConsoleGraphEdge[] {
  const sourceIds = new Set(rule.sourceRefs.map((ref) => ref.sourceId));
  const evidenceCount = rule.sourceRefs.filter((ref) => ref.documentId !== undefined).length;
  return targets.map((target, index) => ({
    id: targets.length === 1 ? rule.id : `${rule.id}#${index}`,
    source: rule.subject,
    target,
    relation: rule.relation,
    claimType: rule.claimType ?? null,
    confidence: rule.confidence,
    status: rule.status,
    sourceCount: sourceIds.size,
    evidenceCount
  }));
}

function nodeStatus(incident: readonly ConsoleGraphEdge[]): ConsoleGraphNode["status"] {
  if (incident.some((edge) => edge.status === "CONFLICTED")) return "CONFLICTED";
  if (incident.some((edge) => edge.status === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  return "APPROVED";
}

/** BFS closure over bidirectional edges, `depth` hops from the focus node. */
function closureWithinDepth(
  edges: readonly ConsoleGraphEdge[],
  focus: string,
  depth: number
): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    const forward = adjacency.get(edge.source) ?? new Set<string>();
    forward.add(edge.target);
    adjacency.set(edge.source, forward);
    const backward = adjacency.get(edge.target) ?? new Set<string>();
    backward.add(edge.source);
    adjacency.set(edge.target, backward);
  }

  const visited = new Set<string>([focus]);
  let frontier = new Set<string>([focus]);
  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set<string>();
    for (const current of frontier) {
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    frontier = next;
  }
  return visited;
}

export function computeKnowledgeGraph(
  rules: readonly StoredKnowledgeRule[],
  query: ConsoleGraphQuery = {}
): ConsoleGraph {
  const status = query.status ?? DEFAULT_STATUS;
  const depth = query.depth ?? DEFAULT_DEPTH;
  const limit = query.limit ?? DEFAULT_LIMIT;
  const includeSynthetic = query.includeSynthetic ?? false;

  const eligible = rules.filter((rule) => {
    if (rule.status === "REJECTED" || rule.status === "SUPERSEDED") return false;
    if (includeSynthetic) return true;
    if (isSyntheticId(rule.subject)) return false;
    if (rule.relation === "has-property") return true;
    return relationTargets(rule).some((target) => !isSyntheticId(target));
  });

  const propertyCounts = new Map<string, number>();
  for (const rule of eligible) {
    if (rule.relation === "has-property" && rule.status === status) {
      propertyCounts.set(rule.subject, (propertyCounts.get(rule.subject) ?? 0) + 1);
    }
  }

  let edges = eligible
    .filter((rule) => rule.relation !== "has-property" && rule.status === status)
    .filter((rule) => (query.claimType === undefined ? true : (rule.claimType ?? null) === query.claimType))
    .flatMap((rule) => toEdges(rule, relationTargets(rule)))
    .filter((edge) => includeSynthetic || !isSyntheticId(edge.target));

  if (query.domain !== undefined && query.domain !== "") {
    edges = edges.filter(
      (edge) => domainOf(edge.source) === query.domain || domainOf(edge.target) === query.domain
    );
  }

  if (query.focusNode !== undefined && query.focusNode !== "") {
    const closure = closureWithinDepth(edges, query.focusNode, depth);
    edges = edges.filter(
      (edge) => closure.has(edge.source) && closure.has(edge.target)
    );
    if (edges.length === 0 && closure.size === 1) {
      return {
        nodes: [
          {
            id: query.focusNode,
            label: labelOf(query.focusNode),
            domain: domainOf(query.focusNode),
            status: "APPROVED",
            metadata: {
              isTaxonomyTerm: getTaxonomyTerm(query.focusNode) !== null,
              incidentEdges: 0,
              propertyCount: propertyCounts.get(query.focusNode) ?? 0,
              knowledgeDomains: []
            }
          }
        ],
        edges: [],
        stats: { rulesConsidered: eligible.length, edgesIncluded: 0, truncated: false, relations: [] }
      };
    }
  }

  edges.sort((a, b) => b.confidence - a.confidence || (a.id < b.id ? -1 : 1));
  const truncated = edges.length > limit;
  if (truncated) {
    edges = edges.slice(0, limit);
  }

  const incident = new Map<string, ConsoleGraphEdge[]>();
  for (const edge of edges) {
    for (const nodeId of [edge.source, edge.target]) {
      const list = incident.get(nodeId) ?? [];
      list.push(edge);
      incident.set(nodeId, list);
    }
  }

  const nodes: ConsoleGraphNode[] = [...incident.keys()]
    .map((id) => {
      const nodeEdges = incident.get(id) ?? [];
      const knowledgeDomains = [
        ...new Set(
          eligible
            .filter((rule) => rule.subject === id || relationTargets(rule).includes(id))
            .map((rule) => rule.knowledgeDomain)
        )
      ];
      return {
        id,
        label: labelOf(id),
        domain: domainOf(id),
        status: nodeStatus(nodeEdges),
        metadata: {
          isTaxonomyTerm: getTaxonomyTerm(id) !== null,
          incidentEdges: nodeEdges.length,
          propertyCount: propertyCounts.get(id) ?? 0,
          knowledgeDomains
        }
      };
    })
    .sort((a, b) => b.metadata.incidentEdges - a.metadata.incidentEdges || (a.id < b.id ? -1 : 1));

  const relations = [...edges.reduce((counts, edge) => {
    counts.set(edge.relation, (counts.get(edge.relation) ?? 0) + 1);
    return counts;
  }, new Map<string, number>())]
    .map(([relation, count]) => ({ relation, count }))
    .sort((a, b) => b.count - a.count || (a.relation < b.relation ? -1 : 1));

  return {
    nodes,
    edges,
    stats: {
      rulesConsidered: eligible.length,
      edgesIncluded: edges.length,
      truncated,
      relations
    }
  };
}
