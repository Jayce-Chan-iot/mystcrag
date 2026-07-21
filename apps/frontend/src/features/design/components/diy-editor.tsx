"use client";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import Link from "next/link";
import * as React from "react";

import { FlowNotice } from "../../../components/flow-notice";
import { getMockDesign, MOCK_MATERIALS, mockReplaceBead } from "../../../lib/api/mock-design-api";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import { toDesignComponentViewModels } from "../model/design-component-view-model";
import { formatMinorAmount } from "../model/format-minor-amount";
import { BraceletPreview } from "./bracelet-preview";
import { ComplianceNotice } from "./compliance-notice";

export function DiyEditor({ designId }: { designId: string }) {
  const initial = React.useMemo(() => getMockDesign(designId), [designId]);
  const [design, setDesign] = React.useState<PublicDesignV1 | null>(initial);
  const [selectedComponentId, setSelectedComponentId] = React.useState(initial?.beads[0]?.componentId ?? "");
  const [selectedMaterialId, setSelectedMaterialId] = React.useState(MOCK_MATERIALS[0]?.id ?? "");
  const [notice, setNotice] = React.useState<FrontendErrorCode | null>(null);
  const [isUpdating, setIsUpdating] = React.useState(false);

  if (!design) return <main className="mx-auto min-h-[70vh] max-w-7xl px-5 py-16"><FlowNotice code="EMPTY_STATE" /></main>;

  const selectedBead = design.beads.find((bead) => bead.componentId === selectedComponentId);
  const selectedMaterial = MOCK_MATERIALS.find((material) => material.id === selectedMaterialId);
  const components = toDesignComponentViewModels(design);

  const replaceSelected = async () => {
    if (!selectedBead || !selectedMaterial) {
      setNotice("VALIDATION_ERROR");
      return;
    }
    setIsUpdating(true);
    setNotice(null);
    try {
      const response = await mockReplaceBead({
        design,
        componentId: selectedBead.componentId,
        materialId: designId === "inventory-changed" ? "unavailable-material" : selectedMaterial.id,
        expectedRevision: designId === "revision-conflict" ? design.revision - 1 : design.revision
      });
      setDesign(response.design);
      if (response.warnings.some((warning) => warning.code === "PRICE_CHANGED")) setNotice("PRICE_CHANGED");
    } catch (error) {
      setNotice(toFrontendApiError(error).code);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] max-w-[96rem] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link className="text-xs text-[var(--muted)] hover:text-[var(--accent)]" href={`/design/session-return`}>← 返回设计方案</Link>
          <h1 className="mt-2 font-serif text-2xl sm:text-3xl">{design.designName} <span className="ml-2 font-sans text-xs text-[var(--muted)]">REV. {design.revision}</span></h1>
        </div>
        <p className="rounded-full border border-[var(--border)] bg-white/60 px-4 py-2 text-sm"><span className="text-[var(--muted)]">当前报价</span> <strong className="ml-2">{formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })}</strong></p>
      </div>

      {notice ? <div className="mb-5"><FlowNotice code={notice} compact onAction={() => setNotice(null)} /></div> : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[18rem_minmax(28rem,1fr)_21rem]">
        <aside className="order-3 min-w-0 rounded-[1.7rem] border border-[var(--border)] bg-[var(--surface)] p-5 lg:order-1" aria-labelledby="material-library-title">
          <div className="flex items-end justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-[var(--accent)]">Materials</p><h2 className="mt-2 font-serif text-2xl" id="material-library-title">材料库</h2></div><span className="text-xs text-[var(--muted)]">{MOCK_MATERIALS.length} 种</span></div>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">先在预览中点击一颗珠子，再选择替换材料。</p>
          <div className="mt-5 flex gap-3 overflow-x-auto pb-2 lg:grid lg:overflow-visible" role="radiogroup" aria-label="替换材料">
            {MOCK_MATERIALS.map((material) => {
              const selected = material.id === selectedMaterialId;
              return (
                <button aria-checked={selected} className={`flex min-w-52 items-center gap-3 rounded-2xl border p-3 text-left transition lg:min-w-0 ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] hover:border-[var(--accent)]/60"}`} key={material.id} onClick={() => setSelectedMaterialId(material.id)} role="radio" type="button">
                  <span className="h-11 w-11 shrink-0 rounded-full border border-white shadow-[inset_-4px_-5px_9px_rgb(59_44_69/0.18),0_4px_10px_rgb(57_45_67/0.12)]" style={{ background: material.color }} />
                  <span className="min-w-0 flex-1"><span className="block font-medium">{material.name}</span><span className="block truncate text-xs text-[var(--muted)]">{material.note}</span></span>
                  <span className="text-xs">{formatMinorAmount({ amountMinor: material.unitPriceMinor, currency: design.currency, locale: design.locale })}</span>
                </button>
              );
            })}
          </div>
          <button className="mt-5 w-full rounded-full bg-[var(--foreground)] px-5 py-3 text-sm text-white transition hover:bg-[var(--accent-deep)] disabled:cursor-wait disabled:opacity-55" disabled={isUpdating || !selectedBead} onClick={() => void replaceSelected()} type="button">{isUpdating ? "正在同步价格…" : `替换为${selectedMaterial?.name ?? "所选材料"}`}</button>
        </aside>

        <section className="order-1 grid min-h-[30rem] min-w-0 place-items-center overflow-hidden rounded-[1.7rem] border border-[var(--border)] bg-[radial-gradient(circle_at_50%_45%,#fff,rgba(231,226,217,.78),rgba(213,205,218,.72))] p-4 lg:order-2 lg:min-h-[43rem]" aria-labelledby="bracelet-preview-title">
          <h2 className="sr-only" id="bracelet-preview-title">3D 手串编辑预览</h2>
          <div>
            <BraceletPreview design={design} interactive onSelect={setSelectedComponentId} selectedComponentId={selectedComponentId} />
            <div className="mx-auto -mt-3 max-w-md rounded-full border border-white/80 bg-white/65 px-4 py-2 text-center text-xs text-[var(--muted)] backdrop-blur" data-error-code="THREE_ASSET_FALLBACK">
              轻量 3D 预览 · 材质加载异常时自动使用可靠替代外观
            </div>
          </div>
        </section>

        <aside className="order-2 min-w-0 space-y-5 rounded-[1.7rem] border border-[var(--border)] bg-[var(--surface)] p-5 lg:order-3" aria-label="设计详情">
          <section aria-labelledby="selected-component-title">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--accent)]">Selected</p>
            <h2 className="mt-2 font-serif text-2xl" id="selected-component-title">选中组件</h2>
            {selectedBead ? <div className="mt-4 rounded-2xl bg-[var(--surface-soft)] p-4 text-sm"><p className="font-medium">第 {selectedBead.positionIndex + 1} 颗 · {selectedBead.diameterMm}mm {selectedBead.shape}</p><p className="mt-2 break-all text-xs text-[var(--muted)]">ID · {selectedBead.componentId}</p><p className="mt-3 text-[var(--muted)]">点击预览中的其他珠子可切换选择。</p></div> : <p className="mt-4 text-sm text-[var(--muted)]">请选择一颗珠子。</p>}
          </section>

          <section className="border-t border-[var(--border)] pt-5" aria-labelledby="component-list-title">
            <div className="flex items-center justify-between"><h2 className="font-serif text-xl" id="component-list-title">组件清单</h2><span className="text-xs text-[var(--muted)]">{components.length} 件</span></div>
            <ol className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1 text-sm">
              {components.map((component) => <li className={`flex items-center justify-between rounded-xl px-3 py-2 ${component.componentId === selectedComponentId ? "bg-[var(--accent-soft)]" : "bg-[var(--surface-soft)]/65"}`} data-component-id={component.componentId} key={component.componentId}><span>{component.label}</span><span className="text-xs text-[var(--muted)]">{component.positionIndex !== undefined ? `#${component.positionIndex + 1}` : "挂饰"}</span></li>)}
            </ol>
          </section>

          <section className="border-t border-[var(--border)] pt-5" aria-labelledby="design-note-title">
            <h2 className="font-serif text-xl" id="design-note-title">设计说明</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{design.story.designStory}</p>
          </section>
          <ComplianceNotice design={design} />
        </aside>
      </div>
    </main>
  );
}
