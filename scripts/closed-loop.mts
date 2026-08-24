/**
 * Closed-loop E2E driver (task book E2E-3 + E2E-4 / EPIC 12 acceptance).
 *
 * Boots nothing itself. Start postgres + migrations + seed, the backend, and
 * the MCP server first:
 *
 *   DATABASE_URL=... pnpm --filter @mystcrag/backend dev
 *   DATABASE_URL=... MCP_TRANSPORT=http pnpm --filter @mystcrag/mcp-server dev
 *   BACKEND_URL=http://localhost:4100 MCP_URL=http://127.0.0.1:3001/mcp \
 *     DATABASE_URL=... pnpm closed-loop
 *
 * Phases: preflight → design journey (recommend→trace→evaluate→optimize→
 * update→save→order) → tarot journey (create→select→reveal→recommend→save) →
 * MCP tool consistency → knowledge usage events (counts + immutability).
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4100";
const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:3001/mcp";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://mystcrag:mystcrag_dev@localhost:5432/mystcrag";
const AUTH_SECRET =
  process.env.MYSTCRAG_AUTH_SIGNING_SECRET ?? "closed-loop-test-signing-secret-2026-08-21";
const AUTH_ISSUER = process.env.MYSTCRAG_AUTH_ISSUER ?? "mystcrag-dev";
const AUTH_AUDIENCE = process.env.MYSTCRAG_AUTH_AUDIENCE ?? "mystcrag-backend";
const ACTOR_ID = "closed-loop-e2e-user";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}${detail === "" ? "" : `  (${detail})`}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail === "" ? "" : `  (${detail})`}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function mintAccessToken(): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const claims = encode({
    sub: ACTOR_ID,
    iss: AUTH_ISSUER,
    aud: AUTH_AUDIENCE,
    exp: nowSeconds + 3600,
    iat: nowSeconds
  });
  const signature = createHmac("sha256", AUTH_SECRET)
    .update(`${header}.${claims}`)
    .digest()
    .toString("base64url");
  return `${header}.${claims}.${signature}`;
}

const token = mintAccessToken();

async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: () => Promise<any> }> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return {
    status: response.status,
    json: async () => (response.headers.get("content-length") === "0" ? undefined : response.json())
  };
}

async function apiJson(method: string, path: string, body?: unknown): Promise<any> {
  const response = await api(method, path, body);
  const json = await response.json().catch(() => undefined);
  if (response.status !== 200) {
    throw new Error(`${method} ${path} → ${response.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

let mcpSessionId: string | undefined;

async function mcpCall(method: string, params?: unknown, notification = false): Promise<any> {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(mcpSessionId === undefined ? {} : { "Mcp-Session-Id": mcpSessionId })
    },
    body: JSON.stringify(
      notification ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", id: Date.now(), method, params }
    )
  });
  const sessionId = response.headers.get("mcp-session-id");
  if (sessionId !== null) mcpSessionId = sessionId;
  if (notification) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = JSON.parse(line.slice(6));
      if (payload.error !== undefined) {
        throw new Error(`MCP ${method} failed: ${JSON.stringify(payload.error)}`);
      }
      if (payload.result !== undefined) return payload.result;
    }
    throw new Error(`MCP ${method} returned no result: ${text}`);
  }
  const payload = JSON.parse(text);
  if (payload.error !== undefined) {
    throw new Error(`MCP ${method} failed: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

async function mcpTool(name: string, args: Record<string, unknown>): Promise<any> {
  const result = await mcpCall("tools/call", { name, arguments: args });
  if (result.isError === true) {
    throw new Error(`MCP tool ${name} errored: ${JSON.stringify(result.content)}`);
  }
  return result.structuredContent;
}

function sql(query: string): string {
  return execFileSync("psql", [DATABASE_URL, "-tA", "-c", query], { encoding: "utf8" }).trim();
}

function sqlFails(query: string): boolean {
  try {
    execFileSync("psql", [DATABASE_URL, "-tA", "-c", query], { encoding: "utf8" });
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  console.log(`closed-loop driver`);
  console.log(`  backend: ${BACKEND_URL}`);
  console.log(`  mcp:     ${MCP_URL}`);
  console.log(`  db:      ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);

  // ---------------------------------------------------------------- phase 0
  section("Phase 0 — preflight");
  const health = await api("GET", "/health");
  check("GET /health → 200 ok", health.status === 200 && (await health.json()).status === "ok");
  const modules = await apiJson("GET", "/api/modules");
  const moduleNames = (modules.modules as Array<{ name: string }>).map((module) => module.name);
  check(
    "GET /api/modules → design + tarot registered",
    moduleNames.includes("design") && moduleNames.includes("tarot"),
    moduleNames.join(", ")
  );
  const init = await mcpCall("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "closed-loop-driver", version: "1.0.0" }
  });
  check("MCP initialize → mystcrag-knowledge", init.serverInfo.name === "mystcrag-knowledge");
  await mcpCall("notifications/initialized", undefined, true);
  const tools = await mcpCall("tools/list");
  const toolNames = (tools.tools as Array<{ name: string }>).map((tool) => tool.name).sort();
  check(
    "MCP tools/list → exactly the five knowledge tools",
    JSON.stringify(toolNames) ===
      JSON.stringify(
        [
          "evaluate_design",
          "get_material_compatibility",
          "get_rules",
          "recommend_palette",
          "search_knowledge"
        ].sort()
      ),
    toolNames.join(", ")
  );
  sql(
    `INSERT INTO users (id, email, display_name, updated_at) VALUES ('${ACTOR_ID}', 'closed-loop@mystcrag.example', '闭环测试用户', CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING;`
  );
  check(
    "closed-loop actor exists in users (FK anchor for designs/orders/sessions)",
    sql(`SELECT count(*) FROM users WHERE id='${ACTOR_ID}';`) === "1"
  );
  const publishedVersion = sql(
    "SELECT version FROM knowledge_versions WHERE status='PUBLISHED' ORDER BY created_at DESC LIMIT 1;"
  );
  check(
    "a knowledge version is published",
    publishedVersion.length > 0,
    publishedVersion
  );
  // Phase 4 asserts exact event shapes for THIS run — reset the collect-only
  // telemetry log so stale rows from earlier runs cannot fail the checks.
  sql("TRUNCATE TABLE knowledge_usage_events;");
  check("knowledge_usage_events reset for this run", sql("SELECT count(*) FROM knowledge_usage_events;") === "0");

  // ---------------------------------------------------------------- phase 1
  section("Phase 1 — design journey (recommend → trace → evaluate → optimize → update → save → order)");
  const recommendRequest = {
    requestId: "e2e-recommend-1",
    locale: "zh-CN",
    currency: "CNY",
    wristCircumferenceMm: 155,
    emotionTags: ["calm"],
    styleTags: ["minimal"],
    colorTags: ["blue"],
    excludedProductIds: [],
    personalizationConsent: false
  };
  const recommended = await apiJson("POST", "/api/design/recommend", recommendRequest);
  check(
    "POST /api/design/recommend → 1–3 candidates",
    recommended.candidates.length >= 1 && recommended.candidates.length <= 3,
    `${recommended.candidates.length} candidates`
  );
  const sortedScores = recommended.candidates.map(
    (candidate: any) => candidate.score.overallScore
  );
  check(
    "candidates are ranked by overallScore desc",
    sortedScores.every((score: number, index: number) => index === 0 || score <= sortedScores[index - 1]),
    sortedScores.join(" > ")
  );
  const top = recommended.candidates[0];
  check(
    "top candidate has beads + score breakdown",
    top.design.beads.length >= 1 &&
      typeof top.score.overallScore === "number" &&
      typeof top.layoutStrategy === "string"
  );

  const trace1 = await apiJson("GET", `/api/design/${top.designId}/trace`);
  check(
    "GET /api/design/:id/trace → decision trace persisted",
    trace1.trace !== null &&
      Array.isArray(trace1.trace.activeRuleIds) &&
      trace1.trace.activeRuleIds.length >= 1 &&
      typeof trace1.trace.decisionRuleSetVersion === "string" &&
      trace1.trace.knowledgeVersion === publishedVersion,
    `activeRuleIds=${trace1.trace?.activeRuleIds?.length ?? 0}, ruleSet=${trace1.trace?.decisionRuleSetVersion}`
  );

  const evaluated1 = await apiJson("POST", "/api/design/evaluate", {
    requestId: "e2e-evaluate-1",
    designId: top.designId
  });
  check(
    "POST /api/design/evaluate → scores + reasons",
    typeof evaluated1.scores.overallScore === "number" &&
      Array.isArray(evaluated1.reasons) &&
      evaluated1.reasons.length >= 1,
    `overall=${evaluated1.scores.overallScore}`
  );

  const designBefore = await apiJson("GET", `/api/design/${top.designId}`);
  const baseRevision = designBefore.revision;

  const lockedBead = designBefore.beads[0];
  const optimized = await apiJson("POST", "/api/design/optimize", {
    requestId: "e2e-optimize-1",
    designId: top.designId,
    expectedRevision: baseRevision,
    lockedComponentIds: [lockedBead.componentId]
  });
  check(
    "POST /api/design/optimize → proposal with operations",
    Array.isArray(optimized.operations) &&
      typeof optimized.score.overallScore === "number" &&
      optimized.design.beads.length >= 1,
    `${optimized.operations.length} operations, overall=${optimized.score.overallScore}`
  );
  check(
    "optimize preserves the locked component",
    optimized.design.beads.some(
      (bead: any) => bead.componentId === lockedBead.componentId
    )
  );

  const lastBead = designBefore.beads[designBefore.beads.length - 1];
  const updated = await apiJson("POST", "/api/design/update", {
    requestId: "e2e-update-1",
    designId: top.designId,
    expectedRevision: baseRevision,
    operations: [
      {
        operation: "MOVE_COMPONENT",
        componentId: lastBead.componentId,
        targetPositionIndex: 0
      }
    ]
  });
  check(
    "POST /api/design/update → next revision persisted",
    updated.design.revision === baseRevision + 1,
    `revision=${updated.design.revision}, beads=${updated.design.beads.length}`
  );

  const evaluated2 = await apiJson("POST", "/api/design/evaluate", {
    requestId: "e2e-evaluate-2",
    designId: top.designId
  });
  check(
    "evaluate after update still scores",
    typeof evaluated2.scores.overallScore === "number",
    `overall=${evaluated2.scores.overallScore}`
  );

  const current = await apiJson("GET", `/api/design/${top.designId}`);
  check(
    "GET /api/design/:id returns the latest revision",
    current.revision === baseRevision + 1 && current.designId === top.designId
  );

  const saved = await apiJson("POST", "/api/design/save", {
    requestId: "e2e-save-1",
    design: current
  });
  check(
    "POST /api/design/save → savedAt",
    typeof saved.savedAt === "string" && saved.savedAt.length > 0,
    `savedAt=${saved.savedAt}`
  );

  const priced = await apiJson("POST", "/api/design/price", {
    requestId: "e2e-price-1",
    currency: "CNY",
    design: current
  });
  check(
    "POST /api/design/price → priced design without warnings",
    Array.isArray(priced.warnings) && priced.warnings.length === 0,
    `total=${priced.design.pricing.totalPriceMinor} minor`
  );

  const order = await apiJson("POST", "/api/orders/from-design", {
    requestId: "e2e-order-1",
    design: current,
    expectedRevision: current.revision,
    expectedPricingVersion: current.pricing.pricingVersion,
    expectedTotalPriceMinor: current.pricing.totalPriceMinor
  });
  check(
    "POST /api/orders/from-design → order created",
    typeof order.orderId === "string" && order.orderId.length > 0,
    `orderId=${order.orderId}, status=${order.orderStatus}`
  );

  // ---------------------------------------------------------------- phase 2
  section("Phase 2 — tarot journey (create → select → reveal → recommend → save)");
  const created = await apiJson("POST", "/api/tarot/sessions", {
    requestId: "e2e-tarot-1",
    spreadType: "SINGLE",
    theme: "SELF_GROWTH"
  });
  const sessionId = created.session.sessionId;
  let revision = created.session.revision;
  check(
    "POST /api/tarot/sessions → DRAWING session",
    created.session.status === "DRAWING" && typeof sessionId === "string",
    `sessionId=${sessionId}, revision=${revision}`
  );

  const selected = await apiJson("POST", `/api/tarot/sessions/${sessionId}/select`, {
    requestId: "e2e-tarot-select-1",
    slot: "GUIDANCE",
    displayedPosition: 12,
    expectedRevision: revision,
    operationId: "e2e-tarot-op-1"
  });
  revision = selected.session.revision;
  check(
    "POST .../select → GUIDANCE accepted",
    selected.session.status === "DRAWING" &&
      selected.session.acceptedSelections.some(
        (selection: any) => selection.slot === "GUIDANCE"
      ),
    `revision=${revision}`
  );

  const revealed = await apiJson("POST", `/api/tarot/sessions/${sessionId}/reveal`, {
    requestId: "e2e-tarot-reveal-1",
    expectedRevision: revision
  });
  revision = revealed.session.revision;
  check(
    "POST .../reveal → one revealed card",
    revealed.session.status === "DRAWN" && revealed.session.revealedCards?.length === 1,
    `card=${revealed.session.revealedCards?.[0]?.cardId}, revision=${revision}`
  );

  const tarotRecommendations = await apiJson(
    "POST",
    `/api/tarot/sessions/${sessionId}/recommendations`,
    {
      requestId: "e2e-tarot-rec-1",
      expectedRevision: revision,
      question: "近期如何保持专注与内在平静？",
      saveQuestion: false,
      locale: "zh-CN",
      currency: "CNY"
    }
  );
  revision = tarotRecommendations.session.revision;
  check(
    "POST .../recommendations → 3 ranked designs",
    tarotRecommendations.session.status === "RECOMMENDED" &&
      tarotRecommendations.session.recommendations?.length === 3,
    `revision=${revision}`
  );
  const tarotTopDesignId = tarotRecommendations.session.recommendations[0].design.designId;
  const tarotDesign = await apiJson("GET", `/api/design/${tarotTopDesignId}`);
  check(
    "tarot-recommended design is persisted and readable",
    tarotDesign.designId === tarotTopDesignId &&
      tarotDesign.designMode === "TAROT_GUIDED"
  );

  const tarotSaved = await apiJson("POST", `/api/tarot/sessions/${sessionId}/save`, {
    requestId: "e2e-tarot-save-1",
    expectedRevision: revision,
    selectedDesignId: tarotTopDesignId
  });
  check(
    "POST .../save → SAVED with selected design",
    tarotSaved.session.status === "SAVED" &&
      tarotSaved.session.selectedDesignId === tarotTopDesignId
  );

  // ---------------------------------------------------------------- phase 3
  section("Phase 3 — MCP tool consistency (same DB, same rules, same engine)");
  const rulesResult = await mcpTool("get_rules", { knowledgeTypes: ["COLOR_THEORY"], limit: 200 });
  const dbColorRules = Number(
    sql("SELECT count(*) FROM knowledge_rules WHERE status='APPROVED' AND knowledge_type='COLOR_THEORY';")
  );
  check(
    "get_rules(COLOR_THEORY) count matches database",
    rulesResult.count === dbColorRules,
    `mcp=${rulesResult.count}, db=${dbColorRules}`
  );

  const searchResult = await mcpTool("search_knowledge", {
    text: "amethyst calm",
    limit: 5
  });
  check(
    "search_knowledge → hits anchored to the published version",
    searchResult.knowledgeVersion === publishedVersion && searchResult.hitCount >= 1,
    `version=${searchResult.knowledgeVersion}, hits=${searchResult.hitCount}`
  );

  const compatibility = await mcpTool("get_material_compatibility", {
    materialTaxonomyId: "material:quartz"
  });
  check(
    "get_material_compatibility → compatible/conflict view",
    Array.isArray(compatibility.compatibleWith) &&
      compatibility.compatibleWith.length >= 1 &&
      compatibility.rules.length >= 1,
    `compatible=${compatibility.compatibleWith.length}, conflicts=${compatibility.conflictsWith.length}`
  );

  const palettes = await mcpTool("recommend_palette", {
    baseColorTaxonomyId: "color:blue",
    paletteSize: 3,
    limit: 5
  });
  check(
    "recommend_palette → ranked palettes including the base color",
    palettes.paletteCount >= 1 &&
      palettes.palettes[0].colors.includes("color:blue"),
    `paletteCount=${palettes.paletteCount}`
  );

  const evaluateArgs = {
    beads: current.beads.map((bead: any) => ({
      beadProductId: bead.beadProductId,
      role: bead.role
    })),
    wristCircumferenceMm: current.bracelet.wristCircumferenceMm,
    ...(current.bracelet.targetInnerCircumferenceMm === undefined
      ? {}
      : { targetInnerCircumferenceMm: current.bracelet.targetInnerCircumferenceMm }),
    layoutStrategy: evaluated2.layoutStrategy,
    currency: "CNY",
    locale: "zh-CN",
    emotionTags: current.story.emotionTags,
    styleTags: current.story.styleTags,
    colorTags: current.story.colorPalette
  };
  const mcpEvaluation = await mcpTool("evaluate_design", evaluateArgs);
  const mcpEvaluationRepeat = await mcpTool("evaluate_design", evaluateArgs);
  check(
    "evaluate_design is deterministic across calls",
    JSON.stringify(mcpEvaluation) === JSON.stringify(mcpEvaluationRepeat)
  );
  const mcpOverall = mcpEvaluation.scores.overallScore;
  const backendOverall = evaluated2.scores.overallScore;
  check(
    "evaluate_design score aligns with backend evaluate",
    Math.abs(mcpOverall - backendOverall) <= 2,
    `mcp=${mcpOverall}, backend=${backendOverall}, Δ=${(mcpOverall - backendOverall).toFixed(2)}`
  );
  check(
    "evaluate_design returns design-score-v1 breakdown + fired rules",
    typeof mcpEvaluation.scores.compositionScore === "number" &&
      Array.isArray(mcpEvaluation.firedRuleIds)
  );

  // ---------------------------------------------------------------- phase 4
  section("Phase 4 — knowledge usage events (collect-only observability)");
  const eventTypeCounts = new Map<string, number>();
  for (const row of sql(
    "SELECT event_type, count(*) FROM knowledge_usage_events GROUP BY event_type ORDER BY event_type;"
  ).split("\n")) {
    const [type, count] = row.split("|");
    eventTypeCounts.set(type, Number(count));
  }
  const expectedEvents: Array<[string, number]> = [
    ["recommendation.served", 2],
    ["rule.fired", 1],
    ["design.created", 4],
    ["design.updated", 1],
    ["design.saved", 1],
    ["design.evaluated", 2],
    ["design.optimized", 1],
    ["tarot.session_saved", 1]
  ];
  for (const [eventType, minimum] of expectedEvents) {
    const actual = eventTypeCounts.get(eventType) ?? 0;
    check(`event ${eventType} recorded ≥${minimum}`, actual >= minimum, `actual=${actual}`);
  }
  const eventsWithoutActor = Number(
    sql("SELECT count(*) FROM knowledge_usage_events WHERE actor_id IS NULL;")
  );
  check("every event anchors the acting user", eventsWithoutActor === 0);
  const ruleEventsMissingVersions = Number(
    sql(
      "SELECT count(*) FROM knowledge_usage_events WHERE event_type IN ('recommendation.served','rule.fired','design.created','design.updated','design.saved','design.evaluated','design.optimized') AND (knowledge_version IS NULL OR product_catalog_version IS NULL);"
    )
  );
  check(
    "rule-anchored events carry knowledge + catalog versions",
    ruleEventsMissingVersions === 0,
    `missing=${ruleEventsMissingVersions}`
  );
  check(
    "design decision traces exist for the generated designs",
    Number(sql("SELECT count(*) FROM design_decision_traces;")) >= 1
  );
  check(
    "knowledge_usage_events rejects UPDATE (immutable trigger)",
    sqlFails("UPDATE knowledge_usage_events SET payload='{}' WHERE id=(SELECT min(id) FROM knowledge_usage_events);")
  );
  check(
    "knowledge_usage_events rejects DELETE (immutable trigger)",
    sqlFails("DELETE FROM knowledge_usage_events WHERE id=(SELECT min(id) FROM knowledge_usage_events);")
  );
  const ordersPlaced = Number(sql("SELECT count(*) FROM orders WHERE user_id='" + ACTOR_ID + "';"));
  check("order persisted for the closed-loop actor", ordersPlaced >= 1, `orders=${ordersPlaced}`);

  // ---------------------------------------------------------------- summary
  console.log(`\n=== summary ===`);
  console.log(`passed: ${passed}, failed: ${failed}`);
  if (failures.length > 0) {
    console.log(`failures:`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(`closed-loop driver crashed: ${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
