"use client";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FlowNotice } from "../../../components/flow-notice";
import { mockGetDesignOptions } from "../../../lib/api/mock-design-api";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import { formatMinorAmount } from "../model/format-minor-amount";
import { BraceletPreview } from "./bracelet-preview";
import { ComplianceNotice } from "./compliance-notice";

const materialNames: Record<string, string> = {
  "aquamarine-clear-v1": "海蓝宝",
  "moonstone-soft-v1": "月光石",
  "clear-quartz-v1": "白水晶"
};

export function DesignResults({ sessionId }: { sessionId: string }) {
  const [designs, setDesigns] = useState<PublicDesignV1[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<FrontendErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void mockGetDesignOptions(sessionId).then((result) => {
      if (!active) return;
      setDesigns(result);
      setErrorCode(result.length === 0 ? "EMPTY_STATE" : null);
    }).catch((error: unknown) => {
      if (active) setErrorCode(toFrontendApiError(error).code);
    });
    return () => { active = false; };
  }, [attempt, sessionId]);

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] max-w-7xl px-5 py-12 sm:px-8 sm:py-20">
      <header className="max-w-3xl">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--accent)]">AI Design · 3 directions</p>
        <h1 className="mt-5 font-serif text-4xl sm:text-6xl">为你整理了三种可能</h1>
        <p className="mt-5 leading-8 text-[var(--muted)]">它们共享你的偏好，却拥有不同的节奏。先选择更接近你的一款，之后仍可进入 DIY 替换每一颗珠子。</p>
      </header>

      {!designs && !errorCode ? (
        <div className="mt-16 grid gap-5 md:grid-cols-3" aria-label="正在生成设计" aria-live="polite">
          {[0, 1, 2].map((item) => <div className="h-[34rem] animate-pulse rounded-[2rem] border border-[var(--border)] bg-white/45" key={item} />)}
        </div>
      ) : null}

      {errorCode ? <div className="mt-12 max-w-xl"><FlowNotice code={errorCode} onAction={errorCode === "NETWORK_ERROR" || errorCode === "AI_GENERATION_FAILED" ? () => setAttempt((value) => value + 1) : undefined} /></div> : null}

      {designs?.length ? (
        <section className="mt-14 grid gap-5 lg:grid-cols-3" aria-label="设计方案">
          {designs.map((design, index) => {
            const selected = selectedId === design.designId;
            const crystals = [...new Set(design.beads.map((bead) => materialNames[bead.materialKey] ?? bead.crystalId))];
            return (
              <article className={`flex flex-col rounded-[2rem] border bg-[var(--surface)] p-5 transition duration-300 sm:p-6 ${selected ? "border-[var(--accent)] shadow-[0_24px_70px_rgb(76_56_93/0.13)]" : "border-[var(--border)] hover:-translate-y-1"}`} key={design.designId} data-design-selected={selected}>
                <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[1.4rem] bg-[radial-gradient(circle_at_50%_42%,#fff,rgba(222,214,226,.65),rgba(225,222,213,.8))]">
                  <BraceletPreview compact design={design} />
                  <span className="absolute left-4 top-4 rounded-full bg-white/75 px-3 py-1.5 text-xs text-[var(--muted)] backdrop-blur">方案 {String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className="flex flex-1 flex-col pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div><h2 className="font-serif text-3xl">{design.designName}</h2><p className="mt-2 text-sm text-[var(--muted)]">{design.story.styleTags.join(" · ")}</p></div>
                    <div className="flex pt-1" aria-label="色彩方案">{design.story.colorPalette.map((color) => <span className="-ml-1 h-6 w-6 rounded-full border-2 border-[var(--surface)]" key={color} style={{ background: color }} />)}</div>
                  </div>
                  <p className="mt-5 text-sm leading-7 text-[var(--muted)]">{design.story.designStory}</p>
                  <div className="mt-5 border-y border-[var(--border)] py-4 text-sm">
                    <p><span className="text-[var(--muted)]">水晶组合</span><span className="float-right">{crystals.join(" · ")}</span></p>
                    <p className="mt-3"><span className="text-[var(--muted)]">推荐理由</span></p>
                    <p className="mt-1 leading-6">{design.story.recommendationReasons[0]}</p>
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-5">
                    <p><span className="text-xs text-[var(--muted)]">设计报价</span><strong className="ml-2 font-serif text-xl">{formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })}</strong></p>
                    <button className={`rounded-full px-4 py-2 text-sm transition ${selected ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] hover:border-[var(--accent)]"}`} onClick={() => setSelectedId(design.designId)} type="button">{selected ? "已选择 ✓" : "选择设计"}</button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {designs?.length ? (
        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <ComplianceNotice design={designs[0]!} />
          {selectedId ? <Link className="rounded-full bg-[var(--foreground)] px-7 py-3.5 text-center text-sm text-white transition hover:bg-[var(--accent-deep)]" href={`/diy/${selectedId}`}>进入 DIY 调整 <span aria-hidden="true">→</span></Link> : <p className="text-sm text-[var(--muted)]">选择一套设计后进入 DIY</p>}
        </div>
      ) : null}
    </main>
  );
}
