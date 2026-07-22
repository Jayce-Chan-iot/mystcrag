"use client";

import type { CreateOrderFromDesignResponse, PublicDesignV1 } from "@mystcrag/design-contract";
import Link from "next/link";
import * as React from "react";

import { FlowNotice } from "../../../components/flow-notice";
import { createReplaceRequest, designApi } from "../../../lib/api/design-api";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import { toDesignComponentViewModels } from "../model/design-component-view-model";
import { formatMinorAmount } from "../model/format-minor-amount";
import { BraceletPreview } from "./bracelet-preview";
import { ComplianceNotice } from "./compliance-notice";

export const DIY_LAYOUT_CLASS = "grid min-w-0 gap-5 lg:grid-cols-[18rem_minmax(28rem,1fr)_21rem]";

function materialColor(materialKey: string): string {
  if (materialKey.includes("aquamarine")) return "#9fcbd5";
  if (materialKey.includes("moonstone")) return "#e9e6de";
  if (materialKey.includes("quartz")) return "#d8e1df";
  return "#b8adbe";
}

export function responseNotice(
  previous: PublicDesignV1,
  next: PublicDesignV1,
  warningCodes: readonly string[]
): FrontendErrorCode | null {
  if (warningCodes.includes("INVENTORY_CHANGED")) return "INVENTORY_CHANGED";
  if (warningCodes.includes("PRICE_CHANGED") || previous.pricing.totalPriceMinor !== next.pricing.totalPriceMinor) return "PRICE_CHANGED";
  return null;
}

export function DiyEditor({ designId }: { designId: string }) {
  const [design, setDesign] = React.useState<PublicDesignV1 | null>(null);
  const [selectedComponentId, setSelectedComponentId] = React.useState("");
  const [selectedProductId, setSelectedProductId] = React.useState("");
  const [notice, setNotice] = React.useState<FrontendErrorCode | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isOrdering, setIsOrdering] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [order, setOrder] = React.useState<CreateOrderFromDesignResponse | null>(null);

  const loadDesign = React.useCallback(async () => {
    try {
      const response = await designApi.get(designId);
      setDesign(response);
      setSelectedComponentId((current) => response.beads.some((bead) => bead.componentId === current) ? current : response.beads[0]?.componentId ?? "");
      setSelectedProductId((current) => response.beads.some((bead) => bead.beadProductId === current) ? current : response.beads[0]?.beadProductId ?? "");
      setNotice(null);
    } catch (error) {
      setNotice(toFrontendApiError(error).code);
    } finally {
      setIsLoading(false);
    }
  }, [designId]);

  React.useEffect(() => {
    let active = true;
    void designApi.get(designId).then((response) => {
      if (!active) return;
      setDesign(response);
      setSelectedComponentId(response.beads[0]?.componentId ?? "");
      setSelectedProductId(response.beads[0]?.beadProductId ?? "");
      setNotice(null);
      setIsLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setNotice(toFrontendApiError(error).code);
      setIsLoading(false);
    });
    return () => { active = false; };
  }, [designId]);

  if (isLoading && !design) {
    return <main className="mx-auto min-h-[70vh] max-w-7xl px-5 py-16" aria-live="polite">正在从 Backend 加载设计…</main>;
  }
  if (!design) {
    return <main className="mx-auto min-h-[70vh] max-w-7xl px-5 py-16"><FlowNotice code={notice ?? "EMPTY_STATE"} onAction={() => { setIsLoading(true); void loadDesign(); }} /></main>;
  }

  const selectedBead = design.beads.find((bead) => bead.componentId === selectedComponentId);
  const materialOptions = [...new Map(design.beads.map((bead) => [bead.beadProductId, bead])).values()];
  const selectedMaterial = materialOptions.find((bead) => bead.beadProductId === selectedProductId);
  const components = toDesignComponentViewModels(design);

  const replaceSelected = async () => {
    if (!selectedBead || !selectedMaterial) {
      setNotice("VALIDATION_ERROR");
      return;
    }
    setIsUpdating(true);
    setNotice(null);
    setSavedAt(null);
    setOrder(null);
    try {
      const previous = design;
      const response = await designApi.update(createReplaceRequest(design, selectedBead.componentId, {
        ...selectedMaterial,
        componentId: selectedBead.componentId,
        positionIndex: selectedBead.positionIndex,
        role: selectedBead.role
      }));
      setDesign(response.design);
      setNotice(responseNotice(previous, response.design, response.warnings.map((warning) => warning.code)));
    } catch (error) {
      setNotice(toFrontendApiError(error).code);
    } finally {
      setIsUpdating(false);
    }
  };

  const save = async () => {
    setIsSaving(true);
    setNotice(null);
    try {
      const response = await designApi.save(design);
      setDesign(response.design);
      setSavedAt(response.savedAt);
    } catch (error) {
      setNotice(toFrontendApiError(error).code);
    } finally {
      setIsSaving(false);
    }
  };

  const createOrder = async () => {
    setIsOrdering(true);
    setNotice(null);
    try {
      const response = await designApi.createOrder(design);
      setDesign(response.design);
      setOrder(response);
    } catch (error) {
      setNotice(toFrontendApiError(error).code);
    } finally {
      setIsOrdering(false);
    }
  };

  const noticeAction = notice === "CONFLICT" ? () => { setIsLoading(true); void loadDesign(); } : () => setNotice(null);

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] max-w-[96rem] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link className="inline-flex min-h-11 items-center text-xs text-[var(--muted)] hover:text-[var(--accent)]" href={`/design/${encodeURIComponent(design.designId)}`}>← 返回设计结果</Link>
          <h1 className="mt-2 font-serif text-2xl sm:text-3xl">{design.designName} <span className="ml-2 font-sans text-xs text-[var(--muted)]">SERVER REV. {design.revision}</span></h1>
        </div>
        <p className="rounded-full border border-[var(--border)] bg-white/60 px-4 py-2 text-sm"><span className="text-[var(--muted)]">Backend 报价</span> <strong className="ml-2">{formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })}</strong></p>
      </div>

      {notice ? <div className="mb-5"><FlowNotice code={notice} compact onAction={noticeAction} /></div> : null}
      {savedAt ? <p className="mb-5 rounded-2xl bg-[var(--accent-soft)] p-4 text-sm text-[var(--success)]" role="status">设计已保存 · {new Date(savedAt).toLocaleString(design.locale)}</p> : null}
      {order ? (
        <section className="mb-5 rounded-2xl border border-[var(--success)]/30 bg-white/70 p-5" aria-labelledby="order-snapshot-title" data-order-id={order.orderId}>
          <h2 className="font-serif text-xl" id="order-snapshot-title">不可变订单快照已生成（未接支付）</h2>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <p><span className="text-[var(--muted)]">Order</span><br />{order.orderId}</p>
            <p><span className="text-[var(--muted)]">Revision</span><br />{order.snapshot.design.revision}</p>
            <p><span className="text-[var(--muted)]">快照价格</span><br />{formatMinorAmount({ amountMinor: order.snapshot.design.pricing.totalPriceMinor, currency: order.snapshot.design.currency, locale: order.snapshot.design.locale })}</p>
          </div>
        </section>
      ) : null}

      <div className={DIY_LAYOUT_CLASS}>
        <aside className="order-3 min-w-0 rounded-[1.7rem] border border-[var(--border)] bg-[var(--surface)] p-5 lg:order-1" aria-labelledby="material-library-title">
          <div className="flex items-end justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-[var(--accent)]">Server materials</p><h2 className="mt-2 font-serif text-2xl" id="material-library-title">当前可替换材料</h2></div><span className="text-xs text-[var(--muted)]">{materialOptions.length} 种</span></div>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">候选来自当前 Backend 设计；提交后仍由服务端目录重新定价并检查库存。</p>
          <div className="mt-5 flex gap-3 overflow-x-auto pb-2 lg:grid lg:overflow-visible" role="radiogroup" aria-label="替换材料">
            {materialOptions.map((material) => {
              const selected = material.beadProductId === selectedProductId;
              return (
                <button aria-checked={selected} className={`flex min-h-11 min-w-52 items-center gap-3 rounded-2xl border p-3 text-left transition lg:min-w-0 ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] hover:border-[var(--accent)]/60"}`} key={material.beadProductId} onClick={() => setSelectedProductId(material.beadProductId)} role="radio" type="button">
                  <span className="h-11 w-11 shrink-0 rounded-full border border-white shadow-[inset_-4px_-5px_9px_rgb(59_44_69/0.18),0_4px_10px_rgb(57_45_67/0.12)]" style={{ background: materialColor(material.materialKey) }} />
                  <span className="min-w-0 flex-1"><span className="block font-medium">{material.crystalId}</span><span className="block truncate text-xs text-[var(--muted)]">{material.diameterMm}mm · {material.shape}</span></span>
                  <span className="text-xs">{formatMinorAmount({ amountMinor: material.unitPriceMinor, currency: design.currency, locale: design.locale })}</span>
                </button>
              );
            })}
          </div>
          <button className="mt-5 min-h-11 w-full rounded-full bg-[var(--foreground)] px-5 py-3 text-sm text-white transition hover:bg-[var(--accent-deep)] disabled:cursor-wait disabled:opacity-55" disabled={isUpdating || !selectedBead} onClick={() => void replaceSelected()} type="button">{isUpdating ? "正在同步价格…" : "提交替换并重新定价"}</button>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button className="min-h-11 rounded-full border border-[var(--accent)] px-4 py-3 text-sm disabled:opacity-55" disabled={isSaving} onClick={() => void save()} type="button">{isSaving ? "保存中…" : "保存设计"}</button>
            <button className="min-h-11 rounded-full bg-[var(--accent)] px-4 py-3 text-sm text-white disabled:opacity-55" disabled={isOrdering} onClick={() => void createOrder()} type="button">{isOrdering ? "生成中…" : "生成订单快照"}</button>
          </div>
        </aside>

        <section className="order-1 grid min-h-[30rem] min-w-0 place-items-center overflow-hidden rounded-[1.7rem] border border-[var(--border)] bg-[radial-gradient(circle_at_50%_45%,#fff,rgba(231,226,217,.78),rgba(213,205,218,.72))] p-4 lg:order-2 lg:min-h-[43rem]" aria-labelledby="bracelet-preview-title">
          <h2 className="sr-only" id="bracelet-preview-title">手串编辑预览</h2>
          <div>
            <BraceletPreview design={design} interactive onSelect={setSelectedComponentId} selectedComponentId={selectedComponentId} />
            <div className="mx-auto -mt-3 max-w-md rounded-full border border-white/80 bg-white/65 px-4 py-2 text-center text-xs text-[var(--muted)] backdrop-blur" data-error-code="THREE_ASSET_FALLBACK">
              轻量预览 · 材质加载异常时使用可靠替代外观
            </div>
          </div>
        </section>

        <aside className="order-2 min-w-0 space-y-5 rounded-[1.7rem] border border-[var(--border)] bg-[var(--surface)] p-5 lg:order-3" aria-label="设计详情">
          <section aria-labelledby="selected-component-title">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--accent)]">Selected</p>
            <h2 className="mt-2 font-serif text-2xl" id="selected-component-title">选中组件</h2>
            {selectedBead ? <div className="mt-4 rounded-2xl bg-[var(--surface-soft)] p-4 text-sm"><p className="font-medium">第 {selectedBead.positionIndex + 1} 颗 · {selectedBead.diameterMm}mm {selectedBead.shape}</p><p className="mt-2 break-all text-xs text-[var(--muted)]">ID · {selectedBead.componentId}</p></div> : <p className="mt-4 text-sm text-[var(--muted)]">请选择一颗珠子。</p>}
          </section>
          <section className="border-t border-[var(--border)] pt-5" aria-labelledby="component-list-title">
            <div className="flex items-center justify-between"><h2 className="font-serif text-xl" id="component-list-title">组件清单</h2><span className="text-xs text-[var(--muted)]">{components.length} 件</span></div>
            <ol className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1 text-sm">
              {components.map((component) => <li className={`flex items-center justify-between rounded-xl px-3 py-2 ${component.componentId === selectedComponentId ? "bg-[var(--accent-soft)]" : "bg-[var(--surface-soft)]/65"}`} data-component-id={component.componentId} key={component.componentId}><span>{component.label}</span><span className="text-xs text-[var(--muted)]">{component.positionIndex !== undefined ? `#${component.positionIndex + 1}` : "挂饰"}</span></li>)}
            </ol>
          </section>
          <section className="border-t border-[var(--border)] pt-5" aria-labelledby="design-note-title"><h2 className="font-serif text-xl" id="design-note-title">设计说明</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{design.story.designStory}</p></section>
          <ComplianceNotice design={design} />
        </aside>
      </div>
    </main>
  );
}
