"use client";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FlowNotice } from "../../../components/flow-notice";
import { designApi } from "../../../lib/api/design-api";
import {
  loadDesignBudgetContext,
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
  const [design, setDesign] = useState<PublicDesignV1 | null>(null);
  const [budget, setBudget] = useState<DesignBudgetContext | null>(null);
  const [selected, setSelected] = useState(false);
  const [errorCode, setErrorCode] = useState<FrontendErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void designApi.get(designId).then((result) => {
      if (!active) return;
      setDesign(result);
      setBudget(loadDesignBudgetContext(designId));
      setErrorCode(null);
    }).catch((error: unknown) => {
      if (active) setErrorCode(toFrontendApiError(error).code);
    });
    return () => { active = false; };
  }, [attempt, designId]);

  const budgetStatus = design ? getBudgetStatus(design.pricing.totalPriceMinor, budget) : "NO_BUDGET";

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <header className="max-w-3xl">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--accent)]">AI Design · persisted result</p>
        <h1 className="mt-5 font-serif text-4xl sm:text-6xl">你的设计已经生成</h1>
        <p className="mt-5 leading-8 text-[var(--muted)]">这份结果由 Backend 保存，并以服务端报价和 revision 为准。进入 DIY 后，每次替换都会重新校验价格与库存。</p>
      </header>

      {!design && !errorCode ? (
        <div className="mt-16 h-[34rem] animate-pulse rounded-[2rem] border border-[var(--border)] bg-white/45" aria-label="正在加载已保存设计" aria-live="polite" />
      ) : null}

      {errorCode ? (
        <div className="mt-12 max-w-xl">
          <FlowNotice code={errorCode} onAction={errorCode === "NETWORK_ERROR" || errorCode === "INTERNAL_ERROR" ? () => setAttempt((value) => value + 1) : undefined} />
        </div>
      ) : null}

      {design ? (
        <section className="mt-14" aria-label="设计结果">
          <article className={`grid gap-7 rounded-[2rem] border bg-[var(--surface)] p-5 transition sm:p-7 lg:grid-cols-[minmax(20rem,0.9fr)_1.1fr] ${selected ? "border-[var(--accent)] shadow-[0_24px_70px_rgb(76_56_93/0.13)]" : "border-[var(--border)]"}`} data-design-selected={selected}>
            <div className="relative grid min-h-80 place-items-center overflow-hidden rounded-[1.4rem] bg-[radial-gradient(circle_at_50%_42%,#fff,rgba(222,214,226,.65),rgba(225,222,213,.8))]">
              <BraceletPreview design={design} />
            </div>
            <div className="flex flex-col">
              <div className="flex items-start justify-between gap-4">
                <div><h2 className="font-serif text-4xl">{design.designName}</h2><p className="mt-2 text-sm text-[var(--muted)]">{design.story.styleTags.join(" · ")}</p></div>
                <div className="flex pt-1" aria-label="色彩方案">{design.story.colorPalette.map((color) => <span className="-ml-1 h-6 w-6 rounded-full border-2 border-[var(--surface)]" key={color} style={{ background: color }} />)}</div>
              </div>
              <p className="mt-6 text-sm leading-7 text-[var(--muted)]">{design.story.designStory}</p>
              <div className="mt-6 border-y border-[var(--border)] py-4 text-sm">
                <p><span className="text-[var(--muted)]">水晶组合</span><span className="float-right">{[...new Set(design.beads.map((bead) => materialNames[bead.materialKey] ?? bead.crystalId))].join(" · ")}</span></p>
                <p className="mt-3"><span className="text-[var(--muted)]">推荐理由</span></p>
                <p className="mt-1 leading-6">{design.story.recommendationReasons[0]}</p>
              </div>
              <div className="mt-6 grid gap-3 rounded-2xl bg-[var(--surface-soft)] p-4 sm:grid-cols-2">
                <p><span className="block text-xs text-[var(--muted)]">Backend 报价</span><strong className="mt-1 block font-serif text-2xl">{formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })}</strong></p>
                <p data-budget-status={budgetStatus} className={budgetStatus === "OVER_BUDGET" ? "text-[var(--danger)]" : "text-[var(--success)]"}><span className="block text-xs opacity-75">预算状态</span><strong className="mt-1 block">{budgetLabels[budgetStatus]}</strong></p>
                <p className="text-xs text-[var(--muted)] sm:col-span-2">Revision {design.revision} · {design.pricing.pricingVersion}</p>
              </div>
              <button className={`mt-6 min-h-11 rounded-full px-5 py-3 text-sm transition ${selected ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] hover:border-[var(--accent)]"}`} onClick={() => setSelected(true)} type="button">{selected ? "已选择 ✓" : "选择这份设计"}</button>
            </div>
          </article>
        </section>
      ) : null}

      {design ? (
        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <ComplianceNotice design={design} />
          {selected ? <Link className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--foreground)] px-7 py-3.5 text-center text-sm text-white transition hover:bg-[var(--accent-deep)]" href={`/diy/${encodeURIComponent(design.designId)}`}>进入 DIY 调整 <span aria-hidden="true">→</span></Link> : <p className="text-sm text-[var(--muted)]">选择设计后进入 DIY</p>}
        </div>
      ) : null}
    </main>
  );
}
