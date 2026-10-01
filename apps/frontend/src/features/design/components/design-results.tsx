"use client";

import type {
  DesignPersistenceStatus,
  ListMyDesignsResponse,
  ListMyOrdersResponse,
  OrderSummaryStatus,
  PublicDesignV1
} from "@mystcrag/design-contract";
import Link from "next/link";
import * as React from "react";
import { useEffect, useState } from "react";

import { FlowNotice } from "../../../components/flow-notice";
import { isMockApiEnabled } from "../../../lib/api/api-runtime";
import { designApi } from "../../../lib/api/design-api";
import {
  loadCompletedOrder,
  loadDesignBudgetContext,
  loadGeneratedDesignOptions,
  setOverBudgetAcceptance,
  type DesignBudgetContext
} from "../../../lib/api/design-session";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import { formatMinorAmount } from "../model/format-minor-amount";
import { evaluateBraceletFit } from "../model/bracelet-fit";
import { BraceletPreview } from "./bracelet-preview";
import { ComplianceNotice } from "./compliance-notice";
import { DesignSummary, formatDesignUtcMinute } from "./design-summary";
import { WearFitSummary } from "./wear-fit-summary";

const materialNames: Record<string, string> = {
  "crystal-aquamarine-material-v1": "海蓝宝",
  "crystal-moonstone-material-v1": "月光石",
  "crystal-clear-quartz-material-v1": "白水晶",
  "crystal-aquamarine": "海蓝宝",
  "crystal-moonstone": "月光石",
  "crystal-clear-quartz": "白水晶",
  "crystal-amethyst": "紫水晶",
  "crystal-rose-quartz": "粉水晶",
  "crystal-citrine": "黄水晶",
  "crystal-green-aventurine": "绿东陵石",
  "crystal-tiger-eye": "虎眼石",
  "crystal-lapis-lazuli": "青金石",
  "crystal-garnet": "石榴石",
  "crystal-labradorite": "拉长石",
  "crystal-black-onyx": "黑玛瑙",
  "crystal-smoky-quartz": "烟晶",
  "crystal-sunstone": "日光石",
  "crystal-amazonite": "天河石",
  "crystal-fluorite": "萤石",
  "crystal-red-agate": "红玛瑙",
  "crystal-rhodonite": "蔷薇辉石"
};

export type BudgetStatus = "NO_BUDGET" | "UNDER_BUDGET" | "WITHIN_BUDGET" | "OVER_BUDGET";

export function getBudgetStatus(totalPriceMinor: number, budget: DesignBudgetContext | null): BudgetStatus {
  if (!budget || (budget.minBudgetMinor === undefined && budget.maxBudgetMinor === undefined)) return "NO_BUDGET";
  if (budget.maxBudgetMinor !== undefined && totalPriceMinor > budget.maxBudgetMinor) return "OVER_BUDGET";
  if (budget.minBudgetMinor !== undefined && totalPriceMinor < budget.minBudgetMinor) return "UNDER_BUDGET";
  return "WITHIN_BUDGET";
}

const budgetLabels: Record<BudgetStatus, string> = {
  NO_BUDGET: "未设置预算上限",
  UNDER_BUDGET: "低于预算区间",
  WITHIN_BUDGET: "预算范围内",
  OVER_BUDGET: "OVER_BUDGET · 超出预算"
};

export type DetailReadStatus = "OK" | "FAILED" | "MOCK";

export type SavedDesignEntry = {
  status: DesignPersistenceStatus;
  design: { designId: string; revision: number };
};

export type OrderSummaryEntry = {
  orderId: string;
  status: OrderSummaryStatus;
  createdAt: string;
  design: { designId: string; revision: number };
};

export type DesignDetailReads = {
  designs: PublicDesignV1[];
  budget: DesignBudgetContext | null;
  savedDesigns: SavedDesignEntry[];
  orders: OrderSummaryEntry[];
  savedDesignsRead: DetailReadStatus;
  ordersRead: DetailReadStatus;
};

export type DesignSaveState =
  | { kind: "CONFIRMED"; status: DesignPersistenceStatus; serverRevision: number }
  | { kind: "STALE_VIEW"; status: DesignPersistenceStatus; serverRevision: number }
  | { kind: "NOT_SAVED" }
  | { kind: "UNKNOWN"; reason: "FAILED" | "MOCK" | "LIMIT" };

export const DESIGN_LIST_LIMIT = 200;

function unknownDetailReadReason(status: Exclude<DetailReadStatus, "OK">): "FAILED" | "MOCK" {
  return status === "MOCK" ? "MOCK" : "FAILED";
}

export function deriveDesignSaveState(design: PublicDesignV1, reads: DesignDetailReads): DesignSaveState {
  if (reads.savedDesignsRead !== "OK") {
    return { kind: "UNKNOWN", reason: unknownDetailReadReason(reads.savedDesignsRead) };
  }
  const entry = reads.savedDesigns.find((item) => item.design.designId === design.designId);
  if (!entry) {
    if (reads.savedDesigns.length >= DESIGN_LIST_LIMIT) return { kind: "UNKNOWN", reason: "LIMIT" };
    return { kind: "NOT_SAVED" };
  }
  if (entry.design.revision === design.revision) {
    return { kind: "CONFIRMED", status: entry.status, serverRevision: entry.design.revision };
  }
  return { kind: "STALE_VIEW", status: entry.status, serverRevision: entry.design.revision };
}

const persistenceLabels: Record<DesignPersistenceStatus, string> = {
  DRAFT: "草稿",
  GENERATED: "刚生成",
  SAVED: "已保存",
  ARCHIVED: "已归档"
};

export function designSaveStateLabel(state: DesignSaveState): string {
  if (state.kind === "CONFIRMED") {
    return `设计库确认：${persistenceLabels[state.status]} · v${state.serverRevision}`;
  }
  if (state.kind === "STALE_VIEW") {
    return `本页版本落后于设计库：设计库为 v${state.serverRevision}（${persistenceLabels[state.status]}）`;
  }
  if (state.kind === "NOT_SAVED") return "尚未保存到设计库";
  if (state.reason === "MOCK") return "本地演示模式，不读取设计库状态";
  if (state.reason === "LIMIT") return "设计库列表只返回最近 200 条，无法确认";
  return "暂时无法确认保存状态";
}

export const ORDER_LIST_LIMIT = 100;

export type LocalOrderRecord = {
  orderId: string;
  orderStatus: OrderSummaryStatus;
  createdAt: string;
  design: { designId: string; revision: number };
};

export type DesignOrderState =
  | { kind: "ORDERED"; orderId: string; status: OrderSummaryStatus; orderedRevision: number; createdAt: string; source: "SERVER" | "LOCAL" }
  | { kind: "NOT_ORDERED" }
  | { kind: "UNKNOWN"; reason: "FAILED" | "MOCK" | "LIMIT" };

export function deriveDesignOrderState(
  design: PublicDesignV1,
  reads: DesignDetailReads,
  readLocalOrder: (designId: string, revision: number) => LocalOrderRecord | null = loadCompletedOrder
): DesignOrderState {
  if (reads.ordersRead === "MOCK") return { kind: "UNKNOWN", reason: "MOCK" };

  const match = reads.orders
    .filter((order) => order.design.designId === design.designId)
    .sort(
      (left, right) =>
        right.design.revision - left.design.revision || right.createdAt.localeCompare(left.createdAt)
    )[0];
  if (match) {
    return {
      kind: "ORDERED",
      orderId: match.orderId,
      status: match.status,
      orderedRevision: match.design.revision,
      createdAt: match.createdAt,
      source: "SERVER"
    };
  }

  const local = readLocalOrder(design.designId, design.revision);
  if (local) {
    return {
      kind: "ORDERED",
      orderId: local.orderId,
      status: local.orderStatus,
      orderedRevision: local.design.revision,
      createdAt: local.createdAt,
      source: "LOCAL"
    };
  }

  if (reads.ordersRead === "FAILED") return { kind: "UNKNOWN", reason: "FAILED" };
  if (reads.orders.length >= ORDER_LIST_LIMIT) return { kind: "UNKNOWN", reason: "LIMIT" };
  return { kind: "NOT_ORDERED" };
}

const orderStatusLabels: Record<OrderSummaryStatus, string> = {
  PENDING: "待确认",
  AWAITING_RESTOCK: "等待补货",
  CONFIRMED: "已确认",
  IN_PRODUCTION: "制作中",
  SHIPPED: "已发货",
  COMPLETED: "已完成",
  CANCELLED: "已取消"
};

export function designOrderStateLabel(state: DesignOrderState, currentRevision: number): string {
  if (state.kind === "ORDERED") {
    if (state.orderedRevision !== currentRevision) {
      return `v${state.orderedRevision} 已下单（${orderStatusLabels[state.status]}），当前 v${currentRevision} 未下单`;
    }
    if (state.source === "LOCAL") {
      return `本机已记录该版本下单（${orderStatusLabels[state.status]}），等待设计库列表确认`;
    }
    return `已下单（${orderStatusLabels[state.status]}）`;
  }
  if (state.kind === "NOT_ORDERED") return "当前版本未下单";
  if (state.reason === "MOCK") return "本地演示模式，不读取订单状态";
  if (state.reason === "LIMIT") return "最近 100 笔订单中未找到，无法确认下单状态";
  return "暂时无法确认下单状态";
}

export type DesignDetailReadApi = {
  get: (designId: string) => Promise<PublicDesignV1>;
  listDesigns: () => Promise<ListMyDesignsResponse>;
  listOrders: () => Promise<ListMyOrdersResponse>;
};

export async function loadDesignDetailReads(
  designId: string,
  api: DesignDetailReadApi = designApi,
  options: { mockApiEnabled?: boolean; optionIds?: string[] } = {}
): Promise<DesignDetailReads> {
  const mockApiEnabled = options.mockApiEnabled ?? isMockApiEnabled;
  const optionIds = options.optionIds ?? loadGeneratedDesignOptions(designId);
  const designs = await Promise.all(optionIds.map((optionId) => api.get(optionId)));
  const budget = loadDesignBudgetContext(designId);

  if (mockApiEnabled) {
    return { designs, budget, savedDesigns: [], orders: [], savedDesignsRead: "MOCK", ordersRead: "MOCK" };
  }

  const [savedResult, ordersResult] = await Promise.allSettled([api.listDesigns(), api.listOrders()]);
  return {
    designs,
    budget,
    savedDesigns: savedResult.status === "fulfilled" ? savedResult.value.designs : [],
    orders: ordersResult.status === "fulfilled" ? ordersResult.value.orders : [],
    savedDesignsRead: savedResult.status === "fulfilled" ? "OK" : "FAILED",
    ordersRead: ordersResult.status === "fulfilled" ? "OK" : "FAILED"
  };
}

export type DesignDetailPanelProps = {
  design: PublicDesignV1;
};

export function DesignDetailPanel({ design }: DesignDetailPanelProps) {
  return (
    <section
      aria-label="设计详情"
      className="mt-6 rounded-[1.5rem] border border-[var(--border)] bg-[var(--star-paper)] p-5"
      data-design-detail-region="true"
    >
      <DesignSummary design={design} />

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-[var(--border)] pt-4">
        <p>
          <span className="block text-xs text-[var(--muted)]">权威总价</span>
          <strong className="mt-1 block font-serif text-2xl text-[var(--foreground)]">
            {formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })}
          </strong>
        </p>
        <p className="text-right text-xs text-[var(--muted)]" data-design-price-provenance="true" data-status-mark="true">
          价格版本 {design.pricing.pricingVersion}
          <br />
          计算于 {formatDesignUtcMinute(design.pricing.priceCalculatedAt)}
        </p>
      </div>

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <WearFitSummary fit={evaluateBraceletFit(design)} />
      </div>

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <ComplianceNotice design={design} />
      </div>
    </section>
  );
}

export function DesignResults({ designId }: { designId: string }) {
  const [reads, setReads] = useState<DesignDetailReads | null>(null);
  const [selectedDesignId, setSelectedDesignId] = useState("");
  const [acceptedOverBudgetIds, setAcceptedOverBudgetIds] = useState<string[]>([]);
  const [errorCode, setErrorCode] = useState<FrontendErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void loadDesignDetailReads(designId).then((next) => {
      if (!active) return;
      const results = next.designs;
      setReads(next);
      setSelectedDesignId((current) =>
        results.some((design) => design.designId === current) ? current : results[0]?.designId ?? ""
      );
      setErrorCode(null);
    }).catch((error: unknown) => {
      if (active) setErrorCode(toFrontendApiError(error).code);
    });
    return () => { active = false; };
  }, [attempt, designId]);

  const designs = reads?.designs ?? [];
  const budget = reads?.budget ?? null;

  const selectedDesign = designs.find((design) => design.designId === selectedDesignId) ?? designs[0];
  const optionCountLabel = designs.length === 0
    ? "正在加载"
    : designs.length === 1
      ? "单个方案"
      : `${designs.length} 个方案`;

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] max-w-[90rem] px-5 pb-28 pt-7 sm:px-8 sm:pt-9" data-atelier-surface="design-results" data-results-layout="comparison-grid" data-star-surface="design-results">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-[0.68rem] uppercase tracking-[0.3em] text-[var(--accent)]">AI Design · {optionCountLabel}</p>
          <h1 className="mt-2 font-serif text-3xl sm:text-5xl">你的设计已经生成</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">选择喜欢的方案，下一步可以继续换珠、调整顺序和尺寸。</p>
        </div>
        <Link className="inline-flex min-h-11 items-center rounded-full px-4 text-sm text-[var(--accent-deep)] transition hover:bg-[var(--accent-soft)]" href="/ai-design">重新生成方案</Link>
      </header>

      {designs.length === 0 && !errorCode ? (
        <div className="mt-8 h-[34rem] animate-pulse rounded-[2rem] border border-[var(--border)] bg-white/45" aria-label="正在加载已保存设计" aria-live="polite" />
      ) : null}

      {errorCode ? (
        <div className="mt-8 max-w-xl">
          <FlowNotice code={errorCode} action={{ kind: "button", label: "重新加载", onAction: () => setAttempt((value) => value + 1) }} onDismissAuthRequired={() => setErrorCode(null)} />
        </div>
      ) : null}

      {designs.length > 0 ? (
        <section className="mt-7 grid min-w-0 gap-4 lg:grid-cols-3" aria-label={`${designs.length} 套设计结果`}>
          {designs.map((design, index) => {
            const selected = selectedDesignId === design.designId;
            const budgetStatus = getBudgetStatus(design.pricing.totalPriceMinor, budget);
            const acceptedOverBudget = acceptedOverBudgetIds.includes(design.designId);
            const materialList = [...new Set(design.beads.map((bead) => materialNames[bead.materialKey] ?? materialNames[bead.crystalId] ?? bead.crystalId))].join(" · ");
            return <article className={`design-result-card flex min-h-0 min-w-0 flex-col rounded-[1.5rem] border bg-[var(--surface)] p-4 transition ${selected ? "border-[var(--accent-deep)] shadow-[0_18px_45px_rgb(76_56_93/0.13)] ring-1 ring-[var(--accent)]/20" : "border-[var(--border)]"}`} data-design-selected={selected} data-option-index={index + 1} data-star-result-card="true" key={design.designId}>
              <div className="flex items-center justify-between">
                <span className={`rounded-full px-3 py-1 text-xs ${selected ? "bg-[var(--accent-deep)] text-white" : "bg-[var(--surface-soft)] text-[var(--muted)]"}`}>方案 {String(index + 1).padStart(2, "0")}</span>
                <button
                  aria-label={selected ? `已选择 ${design.designName}` : `选择 ${design.designName}`}
                  aria-pressed={selected}
                  className={`grid h-11 w-11 place-items-center rounded-full border text-sm transition ${selected ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white" : "border-[var(--border)] text-transparent hover:border-[var(--accent)]"}`}
                  disabled={budgetStatus === "OVER_BUDGET" && !acceptedOverBudget}
                  onClick={() => setSelectedDesignId(design.designId)}
                  type="button"
                >
                  ✓
                </button>
              </div>

              <div className="design-result-preview mt-1 grid h-[clamp(10rem,26vh,17rem)] place-items-center overflow-hidden rounded-[1.1rem] bg-[var(--surface-soft)]/55">
                <div className="w-[min(15rem,24vh)]">
                  <BraceletPreview compact design={design} />
                </div>
              </div>

              <div className="mt-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-serif text-2xl">{design.designName}</h2>
                  <p className="design-result-tags mt-1 truncate text-xs text-[var(--muted)]">{design.story.styleTags.join(" · ")}</p>
                </div>
                <div className="flex shrink-0 pt-1" aria-label="色彩方案">{design.story.colorPalette.slice(0, 4).map((color) => <span className="-ml-1 h-5 w-5 rounded-full border-2 border-[var(--surface)]" key={color} style={{ background: color }} />)}</div>
              </div>

              <p className="mt-3 truncate text-xs text-[var(--muted)]" title={materialList}>水晶组合 · {materialList}</p>
              <p className="design-result-story mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-[var(--muted)]">{design.story.designStory}</p>

              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3">
                <p><span className="block text-xs text-[var(--muted)]">实时价格</span><strong className="mt-1 block font-serif text-xl">{formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })}</strong></p>
                <p data-budget-status={budgetStatus} className={budgetStatus === "OVER_BUDGET" ? "text-right text-[var(--danger)]" : "text-right text-[var(--success)]"}><span className="block text-xs opacity-75">预算状态</span><strong className="mt-1 block text-sm">{budgetLabels[budgetStatus]}</strong></p>
              </div>

              {budgetStatus === "OVER_BUDGET" ? (
                <label className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-xs">
                  <input checked={acceptedOverBudget} onChange={(event) => { const accepted = event.target.checked; setOverBudgetAcceptance(design.designId, accepted); setAcceptedOverBudgetIds((current) => accepted ? [...new Set([...current, design.designId])] : current.filter((id) => id !== design.designId)); }} type="checkbox" />
                  我已知悉并接受超出预算
                </label>
              ) : null}
              <button className={`design-result-select mt-auto min-h-11 rounded-xl px-5 py-2.5 text-sm transition ${selected ? "bg-[var(--accent-deep)] text-white" : "border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"}`} disabled={budgetStatus === "OVER_BUDGET" && !acceptedOverBudget} onClick={() => setSelectedDesignId(design.designId)} type="button">{selected ? "已选择" : budgetStatus === "OVER_BUDGET" && !acceptedOverBudget ? "接受超预算后可选择" : "选择此方案"}</button>
            </article>;
          })}
        </section>
      ) : null}

      {selectedDesign ? (
        <DesignDetailPanel design={selectedDesign} />
      ) : null}

      {selectedDesign ? (
        <div className="sticky bottom-4 z-40 mt-5 flex flex-wrap items-center justify-between gap-4 rounded-[1.4rem] border border-[var(--border)] bg-[var(--star-paper)] p-4 shadow-[0_20px_60px_rgb(57_45_67/0.16)]" data-results-action-bar="true">
          <div>
            <p className="text-xs text-[var(--muted)]">当前选择</p>
            <div className="mt-1 flex items-baseline justify-between gap-3 lg:block">
              <strong className="block font-serif text-xl">{selectedDesign.designName}</strong>
              <span className="block text-sm text-[var(--success)]">{formatMinorAmount({ amountMinor: selectedDesign.pricing.totalPriceMinor, currency: selectedDesign.currency, locale: selectedDesign.locale })}</span>
            </div>
          </div>
          <Link className="inline-flex min-h-14 items-center justify-center rounded-xl bg-[var(--accent-deep)] px-7 text-center text-base font-medium text-white shadow-[0_12px_28px_rgb(73_53_95/0.24)] transition hover:-translate-y-0.5 hover:bg-[var(--accent)]" href={`/diy/${encodeURIComponent(selectedDesign.designId)}`}>进入 DIY 调整</Link>
        </div>
      ) : null}
    </main>
  );
}
