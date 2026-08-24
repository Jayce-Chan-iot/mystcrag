"use client";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FlowNotice } from "../../../components/flow-notice";
import { designApi } from "../../../lib/api/design-api";
import {
  loadDesignBudgetContext,
  loadGeneratedDesignOptions,
  setOverBudgetAcceptance,
  type DesignBudgetContext
} from "../../../lib/api/design-session";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import { formatMinorAmount } from "../model/format-minor-amount";
import { BraceletPreview } from "./bracelet-preview";
import { ComplianceNotice } from "./compliance-notice";

const materialNames: Record<string, string> = {
  "crystal-aquamarine-material-v1": "海蓝宝",
  "crystal-moonstone-material-v1": "月光石",
  "crystal-clear-quartz-material-v1": "白水晶"
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

export function DesignResults({ designId }: { designId: string }) {
  const [designs, setDesigns] = useState<PublicDesignV1[]>([]);
  const [budget, setBudget] = useState<DesignBudgetContext | null>(null);
  const [selectedDesignId, setSelectedDesignId] = useState("");
  const [acceptedOverBudgetIds, setAcceptedOverBudgetIds] = useState<string[]>([]);
  const [errorCode, setErrorCode] = useState<FrontendErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const optionIds = loadGeneratedDesignOptions(designId);
    void Promise.all(optionIds.map((optionId) => designApi.get(optionId))).then((results) => {
      if (!active) return;
      setDesigns(results);
      setSelectedDesignId((current) => results.some((design) => design.designId === current) ? current : results[0]?.designId ?? "");
      setBudget(loadDesignBudgetContext(designId));
      setErrorCode(null);
    }).catch((error: unknown) => {
      if (active) setErrorCode(toFrontendApiError(error).code);
    });
    return () => { active = false; };
  }, [attempt, designId]);

  const selectedDesign = designs.find((design) => design.designId === selectedDesignId) ?? designs[0];
  const optionCountLabel = designs.length === 0
    ? "正在加载"
    : designs.length === 1
      ? "单个方案"
      : `${designs.length} 个方案`;

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] max-w-[90rem] px-5 pb-28 pt-7 sm:px-8 sm:pt-9" data-atelier-surface="design-results" data-results-layout="comparison-grid">
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
          <FlowNotice code={errorCode} onAction={errorCode === "NETWORK_ERROR" || errorCode === "INTERNAL_ERROR" ? () => setAttempt((value) => value + 1) : undefined} />
        </div>
      ) : null}

      {designs.length > 0 ? (
        <section className="mt-7 grid min-w-0 gap-4 lg:grid-cols-3" aria-label={`${designs.length} 套设计结果`}>
          {designs.map((design, index) => {
            const selected = selectedDesignId === design.designId;
            const budgetStatus = getBudgetStatus(design.pricing.totalPriceMinor, budget);
            const acceptedOverBudget = acceptedOverBudgetIds.includes(design.designId);
            const materialList = [...new Set(design.beads.map((bead) => materialNames[bead.materialKey] ?? bead.crystalId))].join(" · ");
            return <article className={`design-result-card flex min-h-0 min-w-0 flex-col rounded-[1.5rem] border bg-[var(--surface)] p-4 transition ${selected ? "border-[var(--accent-deep)] shadow-[0_18px_45px_rgb(76_56_93/0.13)] ring-1 ring-[var(--accent)]/20" : "border-[var(--border)]"}`} data-design-selected={selected} data-option-index={index + 1} key={design.designId}>
              <div className="flex items-center justify-between">
                <span className={`rounded-full px-3 py-1 text-xs ${selected ? "bg-[var(--accent-deep)] text-white" : "bg-[var(--surface-soft)] text-[var(--muted)]"}`}>方案 {String(index + 1).padStart(2, "0")}</span>
                <button
                  aria-label={selected ? `已选择 ${design.designName}` : `选择 ${design.designName}`}
                  aria-pressed={selected}
                  className={`grid h-8 w-8 place-items-center rounded-full border text-sm transition ${selected ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white" : "border-[var(--border)] text-transparent hover:border-[var(--accent)]"}`}
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
        <div className="sticky bottom-4 z-40 mt-5 grid gap-4 rounded-[1.4rem] border border-[var(--border)] bg-white/94 p-4 shadow-[0_20px_60px_rgb(57_45_67/0.16)] backdrop-blur lg:grid-cols-[minmax(13rem,0.7fr)_minmax(18rem,1fr)_minmax(16rem,0.8fr)] lg:items-center" data-results-action-bar="true">
          <div>
            <p className="text-xs text-[var(--muted)]">当前选择</p>
            <div className="mt-1 flex items-baseline justify-between gap-3 lg:block">
              <strong className="block font-serif text-xl">{selectedDesign.designName}</strong>
              <span className="block text-sm text-[var(--success)]">{formatMinorAmount({ amountMinor: selectedDesign.pricing.totalPriceMinor, currency: selectedDesign.currency, locale: selectedDesign.locale })}</span>
            </div>
          </div>
          <div className="min-w-0">
            <ComplianceNotice design={selectedDesign} />
          </div>
          <Link className="inline-flex min-h-14 items-center justify-center rounded-xl bg-[var(--accent-deep)] px-7 text-center text-base font-medium text-white shadow-[0_12px_28px_rgb(73_53_95/0.24)] transition hover:-translate-y-0.5 hover:bg-[var(--accent)]" href={`/diy/${encodeURIComponent(selectedDesign.designId)}`}>进入 DIY 调整</Link>
        </div>
      ) : null}
    </main>
  );
}
