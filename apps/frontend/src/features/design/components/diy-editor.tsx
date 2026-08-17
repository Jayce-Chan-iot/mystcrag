"use client";

import type {
  CatalogMaterialProduct,
  CreateOrderFromDesignResponse,
  PublicDesignV1,
  UpdateDesignRequest
} from "@mystcrag/design-contract";
import Link from "next/link";
import * as React from "react";

import { FlowNotice } from "../../../components/flow-notice";
import {
  createAddRequest,
  createMoveRequest,
  createRemoveRequest,
  designApi
} from "../../../lib/api/design-api";
import { hasOverBudgetAcceptance, loadDesignBudgetContext } from "../../../lib/api/design-session";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import { toDesignComponentViewModels } from "../model/design-component-view-model";
import { evaluateBraceletFit } from "../model/bracelet-fit";
import { formatMinorAmount } from "../model/format-minor-amount";
import { ComplianceNotice } from "./compliance-notice";
import { CrystalBeadImage, crystalFilter } from "./crystal-bead-image";
import { FlatBraceletEditor } from "./flat-bracelet-editor";

export const DIY_LAYOUT_CLASS = "mx-auto w-full max-w-[70rem]";

const CATALOG_CATEGORIES = [
  { id: "CURRENT", label: "正在使用" },
  { id: "ALL", label: "水晶" },
  { id: "clear", label: "白水晶" },
  { id: "purple", label: "紫水晶" },
  { id: "blue", label: "蓝水晶" },
  { id: "pink", label: "粉水晶" },
  { id: "yellow", label: "黄水晶" }
] as const;

const COLOR_TAG_LABELS: Record<string, string> = {
  black: "黑色",
  blue: "蓝色",
  brown: "棕色",
  clear: "透明",
  gold: "金色",
  gray: "灰色",
  green: "绿色",
  neutral: "中性色",
  orange: "橙色",
  pink: "粉色",
  purple: "紫色",
  red: "红色",
  white: "白色",
  wine: "酒红色",
  yellow: "黄色"
};

export function responseNotice(
  warningCodes: readonly string[]
): FrontendErrorCode | null {
  if (warningCodes.includes("INVENTORY_CHANGED")) return "INVENTORY_CHANGED";
  return null;
}

export function DiyEditor({ designId }: { designId: string }) {
  const [design, setDesign] = React.useState<PublicDesignV1 | null>(null);
  const [catalogMaterials, setCatalogMaterials] = React.useState<CatalogMaterialProduct[]>([]);
  const [catalogQuery, setCatalogQuery] = React.useState("");
  const [catalogCategory, setCatalogCategory] = React.useState("ALL");
  const [catalogColor, setCatalogColor] = React.useState("ALL");
  const [catalogDiameter, setCatalogDiameter] = React.useState("ALL");
  const [selectedComponentId, setSelectedComponentId] = React.useState("");
  const [braceletConnected, setBraceletConnected] = React.useState(false);
  const [notice, setNotice] = React.useState<FrontendErrorCode | null>(null);
  const [editMessage, setEditMessage] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isOrdering, setIsOrdering] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [order, setOrder] = React.useState<CreateOrderFromDesignResponse | null>(null);

  const loadDesign = React.useCallback(async () => {
    try {
      const response = await designApi.get(designId);
      setDesign(response);
      const catalog = await designApi.materials(response.currency);
      setCatalogMaterials(catalog.materials);
      setSelectedComponentId((current) => response.beads.some((bead) => bead.componentId === current) ? current : response.beads[0]?.componentId ?? "");
      setNotice(null);
    } catch (error) {
      setNotice(toFrontendApiError(error).code);
    } finally {
      setIsLoading(false);
    }
  }, [designId]);

  React.useEffect(() => {
    let active = true;
    void designApi.get(designId).then(async (response) => {
      if (!active) return;
      setDesign(response);
      const catalog = await designApi.materials(response.currency);
      if (!active) return;
      setCatalogMaterials(catalog.materials);
      setSelectedComponentId(response.beads[0]?.componentId ?? "");
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
    return <main className="mx-auto min-h-[70vh] max-w-7xl px-5 py-16" aria-live="polite" data-diy-editor-page="true">正在从 Backend 加载设计…</main>;
  }
  if (!design) {
    return <main className="mx-auto min-h-[70vh] max-w-7xl px-5 py-16" data-diy-editor-page="true"><FlowNotice code={notice ?? "EMPTY_STATE"} onAction={() => { setIsLoading(true); void loadDesign(); }} /></main>;
  }

  const selectedBead = design.beads.find((bead) => bead.componentId === selectedComponentId);
  const braceletFit = evaluateBraceletFit(design);
  const selectedMaterial = selectedBead
    ? catalogMaterials.find((material) => material.beadProductId === selectedBead.beadProductId)
    : undefined;
  const catalogColors = [...new Set(catalogMaterials.flatMap((material) => material.colorTags))]
    .filter((tag) => tag in COLOR_TAG_LABELS)
    .sort();
  const catalogDiameters = [...new Set(catalogMaterials.map((material) => material.diameterMm))].sort((left, right) => left - right);
  const normalizedCatalogQuery = catalogQuery.trim().toLocaleLowerCase(design.locale);
  const activeProductIds = new Set(design.beads.map((bead) => bead.beadProductId));
  const materialOptions = catalogMaterials.filter((material) => {
    const matchesQuery = normalizedCatalogQuery.length === 0 || [
      material.displayName,
      material.crystalNameCn,
      material.crystalNameEn,
      material.crystalId
    ].some((value) => value.toLocaleLowerCase(design.locale).includes(normalizedCatalogQuery));
    const matchesColor = catalogColor === "ALL" || material.colorTags.includes(catalogColor);
    const matchesDiameter = catalogDiameter === "ALL" || material.diameterMm === Number(catalogDiameter);
    const matchesCategory = catalogCategory === "ALL"
      || (catalogCategory === "CURRENT" && activeProductIds.has(material.beadProductId))
      || (catalogCategory !== "CURRENT" && material.colorTags.includes(catalogCategory));
    return matchesQuery && matchesColor && matchesDiameter && matchesCategory;
  });
  const components = toDesignComponentViewModels(design);
  const ringLength = design.production.componentSequence.length;
  const selectedAnchorsAccessory = design.accessories.some(
    (accessory) => accessory.placementMode === "ANCHORED" && accessory.anchorComponentId === selectedComponentId
  );
  const designSummary = Array.from(
    design.beads.reduce((summary, bead) => {
      const material = catalogMaterials.find((candidate) => candidate.beadProductId === bead.beadProductId);
      const current = summary.get(bead.beadProductId);
      summary.set(bead.beadProductId, {
        beadProductId: bead.beadProductId,
        materialKey: bead.materialKey,
        name: material?.crystalNameCn ?? bead.materialKey,
        diameterMm: bead.diameterMm,
        count: (current?.count ?? 0) + 1,
        unitPriceMinor: bead.unitPriceMinor
      });
      return summary;
    }, new Map<string, {
      beadProductId: string;
      materialKey: string;
      name: string;
      diameterMm: number;
      count: number;
      unitPriceMinor: number;
    }>())
  ).map(([, item]) => item);

  const applyUpdate = async (
    request: UpdateDesignRequest,
    successMessage: string,
    resolveSelection: (next: PublicDesignV1) => string = () => selectedComponentId
  ) => {
    setIsUpdating(true);
    setNotice(null);
    setEditMessage("");
    setSavedAt(null);
    setOrder(null);
    try {
      const updateResponse = await designApi.update(request);
      const priceResponse = await designApi.price(updateResponse.design);
      const warnings = [...updateResponse.warnings, ...priceResponse.warnings];
      // Price is an authoritative commercial check, but /price does not persist a
      // revision. Keep the persisted /update design so a subsequent save cannot
      // submit an unpersisted priceCalculatedAt value.
      setDesign(updateResponse.design);
      setSelectedComponentId(resolveSelection(updateResponse.design));
      setEditMessage(successMessage);
      setNotice(responseNotice(warnings.map((warning) => warning.code)));
    } catch (error) {
      setNotice(toFrontendApiError(error).code);
    } finally {
      setIsUpdating(false);
    }
  };

  const addMaterial = async (material: CatalogMaterialProduct) => {
    const insertAt = selectedBead ? selectedBead.positionIndex + 1 : ringLength;
    const componentId = `component-${crypto.randomUUID()}`;
    await applyUpdate(
      createAddRequest(design, material, insertAt, componentId),
      "珠子已加入手串。",
      () => componentId
    );
  };

  const moveBead = async (componentId: string, targetPositionIndex: number) => {
    const current = design.beads.find((bead) => bead.componentId === componentId);
    if (!current || current.positionIndex === targetPositionIndex) return;
    await applyUpdate(
      createMoveRequest(design, componentId, targetPositionIndex),
      "珠子顺序已更新。",
      () => componentId
    );
  };

  const removeBead = async (componentId: string) => {
    const current = design.beads.find((bead) => bead.componentId === componentId);
    if (!current) return;
    const anchorsAccessory = design.accessories.some(
      (accessory) => accessory.placementMode === "ANCHORED" && accessory.anchorComponentId === componentId
    );
    if (anchorsAccessory) {
      setEditMessage("这颗珠子连接着挂饰，请先调整挂饰锚点后再移除。");
      return;
    }
    if (design.beads.length <= 1) {
      setEditMessage("手串至少需要保留一颗珠子。");
      return;
    }
    await applyUpdate(
      createRemoveRequest(design, componentId),
      "珠子已从手串移除。",
      (next) => next.beads[Math.min(current.positionIndex, next.beads.length - 1)]?.componentId ?? ""
    );
  };

  const moveSelectedBy = (offset: -1 | 1) => {
    if (!selectedBead) return;
    const target = Math.min(Math.max(0, selectedBead.positionIndex + offset), ringLength - 1);
    if (target !== selectedBead.positionIndex) void moveBead(selectedBead.componentId, target);
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

  const clearDesign = async () => {
    if (design.beads.length <= 1) {
      setEditMessage("手串至少需要保留一颗珠子。");
      return;
    }
    if (!window.confirm("清空后将只保留一颗基础珠子，是否继续？")) return;

    const protectedComponentId = design.accessories.find(
      (accessory) => accessory.placementMode === "ANCHORED"
    )?.anchorComponentId;
    const keepComponentId = protectedComponentId ?? design.beads[0]?.componentId;
    const removableBeads = [...design.beads]
      .filter((bead) => bead.componentId !== keepComponentId)
      .sort((left, right) => right.positionIndex - left.positionIndex);

    setIsUpdating(true);
    setNotice(null);
    setEditMessage("");
    setSavedAt(null);
    setOrder(null);
    try {
      let nextDesign = design;
      const warnings: string[] = [];
      for (const bead of removableBeads) {
        const response = await designApi.update(createRemoveRequest(nextDesign, bead.componentId));
        nextDesign = response.design;
        warnings.push(...response.warnings.map((warning) => warning.code));
      }
      const priceResponse = await designApi.price(nextDesign);
      warnings.push(...priceResponse.warnings.map((warning) => warning.code));
      setDesign(nextDesign);
      setSelectedComponentId(nextDesign.beads[0]?.componentId ?? "");
      setEditMessage("设计已清空，可重新从珠子库开始搭配。");
      setNotice(responseNotice(warnings));
    } catch (error) {
      setNotice(toFrontendApiError(error).code);
    } finally {
      setIsUpdating(false);
    }
  };

  const exportDesignImage = async () => {
    setIsExporting(true);
    setEditMessage("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1200;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("CANVAS_UNAVAILABLE");

      context.fillStyle = "#fffdf8";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#25202a";
      context.font = '600 42px "Noto Sans SC", "PingFang SC", sans-serif';
      context.textAlign = "center";
      context.fillText("玄矶 · DIY 手串", 600, 82);
      context.fillStyle = "#746d78";
      context.font = '28px "Noto Sans SC", "PingFang SC", sans-serif';
      context.fillText(
        `当前手围 ${braceletFit.circumferenceCmLabel}cm · ${formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })}`,
        600,
        128
      );

      const image = new Image();
      image.src = "/beads/crystal-bead-base.png";
      const accessoryImage = new Image();
      accessoryImage.src = "/accessories/silver-star-ring-charm.png";
      await Promise.all([image.decode(), accessoryImage.decode()]);
      const exportComponents = [
        ...design.beads.map((bead) => ({ ...bead, kind: "BEAD" as const })),
        ...design.accessories
          .filter((accessory) => accessory.placementMode === "INLINE")
          .map((accessory) => ({ ...accessory, kind: "ACCESSORY" as const }))
      ].sort((left, right) => left.positionIndex - right.positionIndex);
      const radius = 360;
      for (const [index, component] of exportComponents.entries()) {
        const angle = (index / exportComponents.length) * Math.PI * 2 - Math.PI / 2;
        if (component.kind === "BEAD") {
          const size = 148;
          const x = 600 + Math.cos(angle) * radius - size / 2;
          const y = 620 + Math.sin(angle) * radius - size / 2;
          context.filter = crystalFilter(component.materialKey);
          context.drawImage(image, x, y, size, size);
        } else {
          const width = 220;
          const height = 138;
          const x = 600 + Math.cos(angle) * radius - width / 2;
          const y = 620 + Math.sin(angle) * radius - height / 2;
          context.filter = "none";
          context.drawImage(accessoryImage, x, y, width, height);
        }
      }
      context.filter = "none";
      context.fillStyle = "#746d78";
      context.font = '24px "Noto Sans SC", "PingFang SC", sans-serif';
      context.fillText("由玄矶 Mystcrag 设计", 600, 1136);

      const link = document.createElement("a");
      link.download = `玄矶-${design.designId}-设计图.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      setEditMessage("设计图已导出为 PNG。");
    } catch {
      setEditMessage("设计图导出失败，请稍后重试。");
    } finally {
      setIsExporting(false);
    }
  };

  const createOrder = async () => {
    if (!braceletFit.canComplete) {
      setEditMessage(braceletFit.message ?? "当前手围暂时无法完成设计。");
      return;
    }
    const budget = loadDesignBudgetContext(design.designId);
    if (budget?.maxBudgetMinor !== undefined && design.pricing.totalPriceMinor > budget.maxBudgetMinor && !hasOverBudgetAcceptance(design.designId)) {
      setNotice("VALIDATION_ERROR");
      return;
    }
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
    <main className="min-h-screen" data-diy-editor-page="true">
      <div className="hidden h-screen overflow-hidden bg-[var(--surface)] lg:block" data-desktop-diy-workspace="true">
        <header className="grid h-[4.75rem] grid-cols-[clamp(13rem,19vw,18rem)_minmax(0,1fr)_clamp(13rem,19vw,18rem)] items-center border-b border-[var(--border)]/70 bg-white/85">
          <div className="flex h-full items-center gap-3 border-r border-[var(--border)]/70 px-5 xl:gap-5 xl:px-7">
            <Link className="font-serif text-[1.75rem] tracking-[0.08em] text-[var(--accent-deep)]" href="/">玄矶</Link>
            <span className="h-6 w-px bg-[var(--border)]" aria-hidden="true" />
            <span className="font-serif text-lg">DIY 手串</span>
          </div>
          <div className="flex items-center justify-center gap-3">
            <span className="rounded-full border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)]">
              当前手围 {braceletFit.circumferenceCmLabel}cm
            </span>
            <strong className="rounded-full bg-[var(--accent-deep)] px-4 py-2 text-sm font-medium text-white">
              {formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })}
            </strong>
          </div>
          <div className="flex items-center justify-end gap-1 px-3 xl:gap-2 xl:px-6">
            <button
              className="min-h-11 rounded-full border border-[var(--border)] px-3 text-xs transition hover:border-[var(--accent)] disabled:opacity-55 xl:px-5 xl:text-sm"
              disabled={isSaving}
              onClick={() => void save()}
              type="button"
            >
              {isSaving ? "保存中…" : savedAt ? "已保存" : "保存"}
            </button>
            <button
              className="min-h-11 rounded-full bg-[var(--accent-deep)] px-3 text-xs text-white transition hover:bg-[var(--accent)] disabled:opacity-55 xl:px-6 xl:text-sm"
              disabled={isExporting}
              onClick={() => void exportDesignImage()}
              type="button"
            >
              {isExporting ? "导出中…" : "导出设计图"}
            </button>
          </div>
        </header>

        <div className="grid h-[calc(100dvh-4.75rem)] min-h-0 grid-cols-[clamp(13rem,19vw,18rem)_minmax(0,1fr)_clamp(13rem,19vw,18rem)] grid-rows-[minmax(0,1fr)_clamp(11.5rem,30vh,14rem)]">
          <aside className="row-span-2 min-h-0 overflow-y-auto border-r border-[var(--border)]/70 bg-[#fbf8f2] px-5 py-5 xl:px-6 xl:py-6" aria-labelledby="desktop-library-title">
            <h2 className="font-serif text-2xl" id="desktop-library-title">完整珠子库</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{materialOptions.length}/{catalogMaterials.length} 款可选</p>

            <label className="sr-only" htmlFor="desktop-catalog-search">搜索珠子</label>
            <input
              className="mt-6 min-h-11 w-full rounded-full border border-[var(--border)] bg-white px-4 text-sm outline-none transition focus:border-[var(--accent)]"
              id="desktop-catalog-search"
              onChange={(event) => setCatalogQuery(event.target.value)}
              placeholder="搜索珠子"
              type="search"
              value={catalogQuery}
            />

            <div className="mt-4 grid grid-cols-2 gap-2">
              <label className="sr-only" htmlFor="desktop-catalog-color">颜色</label>
              <select
                className="min-h-11 rounded-full border border-[var(--border)] bg-white px-3 text-sm text-[var(--muted)]"
                id="desktop-catalog-color"
                onChange={(event) => setCatalogColor(event.target.value)}
                value={catalogColor}
              >
                <option value="ALL">颜色</option>
                {catalogColors.map((color) => <option key={color} value={color}>{COLOR_TAG_LABELS[color]}</option>)}
              </select>
              <label className="sr-only" htmlFor="desktop-catalog-diameter">尺寸</label>
              <select
                className="min-h-11 rounded-full border border-[var(--border)] bg-white px-3 text-sm text-[var(--muted)]"
                id="desktop-catalog-diameter"
                onChange={(event) => setCatalogDiameter(event.target.value)}
                value={catalogDiameter}
              >
                <option value="ALL">尺寸</option>
                {catalogDiameters.map((diameter) => <option key={diameter} value={diameter}>{diameter}mm</option>)}
              </select>
            </div>

            <nav className="mt-6 space-y-1" aria-label="桌面珠子分类">
              {CATALOG_CATEGORIES.map((category) => (
                <button
                  aria-pressed={catalogCategory === category.id}
                  className={`flex min-h-12 w-full items-center justify-between rounded-xl px-4 text-left text-sm transition ${
                    catalogCategory === category.id
                      ? "bg-[var(--accent-deep)] text-white"
                      : "text-[var(--muted)] hover:bg-white hover:text-[var(--foreground)]"
                  }`}
                  key={category.id}
                  onClick={() => setCatalogCategory(category.id)}
                  type="button"
                >
                  <span>{category.label}</span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </nav>

            <div className="mt-7 border-t border-[var(--border)]/70 pt-5 text-xs leading-6 text-[var(--muted)]">
              <p>点击珠子即可加入手串。</p>
              <p>拖动可换位，拖到中间删除区即可移除。</p>
            </div>
          </aside>

          <section className="relative overflow-hidden border-b border-[var(--border)]/70 bg-[var(--surface)] px-8" aria-labelledby="desktop-preview-title">
            <h1 className="sr-only" id="desktop-preview-title">DIY 手串编辑预览</h1>
            {notice ? <div className="absolute left-8 right-8 top-4 z-40"><FlowNotice code={notice} compact onAction={noticeAction} /></div> : null}
            <button
              aria-pressed={braceletConnected}
              className="absolute right-8 top-4 z-30 min-h-11 rounded-full border border-[var(--accent)] bg-white/90 px-5 text-sm text-[var(--accent-deep)] shadow-sm transition hover:bg-[var(--accent-soft)] disabled:opacity-55"
              disabled={isUpdating}
              onClick={() => setBraceletConnected((current) => !current)}
              type="button"
            >
              {braceletConnected ? "散开查看" : "收缩成串"}
            </button>
            {editMessage ? (
              <p className="absolute left-8 top-4 z-30 rounded-full bg-[var(--accent-soft)] px-5 py-2 text-sm text-[var(--success)] shadow-sm" role="status">
                {editMessage}
              </p>
            ) : null}
            <div className="flex h-full min-h-0 flex-col items-center justify-center pb-4 pt-3">
              <FlatBraceletEditor
                busy={isUpdating}
                connected={braceletConnected}
                design={design}
                fit={braceletFit}
                fitDesktopViewport
                onMove={(componentId, targetPositionIndex) => void moveBead(componentId, targetPositionIndex)}
                onRemove={(componentId) => void removeBead(componentId)}
                onSelect={setSelectedComponentId}
                selectedComponentId={selectedComponentId}
              />
              <p className="-mt-1 text-center text-sm tracking-[0.08em] text-[var(--muted)]">
                点击加入 · 拖动换位 · 拖到中间删除
              </p>
            </div>
          </section>

          <aside className="row-span-2 flex min-h-0 flex-col border-l border-[var(--border)]/70 bg-white px-5 py-6" aria-labelledby="selected-material-title">
            <section>
              <h2 className="font-serif text-xl" id="selected-material-title">当前选中</h2>
              {selectedBead ? (
                <div className="mt-5 flex items-center gap-4">
                  <span className="block h-16 w-16 shrink-0">
                    <CrystalBeadImage alt="" materialKey={selectedBead.materialKey} sizes="64px" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{selectedMaterial?.crystalNameCn ?? selectedBead.materialKey}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{selectedBead.diameterMm}mm</p>
                    <p className="mt-1 text-sm">
                      {formatMinorAmount({ amountMinor: selectedBead.unitPriceMinor, currency: design.currency, locale: design.locale })}
                    </p>
                  </div>
                </div>
              ) : <p className="mt-4 text-sm text-[var(--muted)]">请选择一颗珠子。</p>}
            </section>

            <section className="mt-6 min-h-0 flex-1 border-t border-[var(--border)]/70 pt-5" aria-labelledby="desktop-design-summary-title">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-xl" id="desktop-design-summary-title">设计总览</h2>
                <span className="text-xs text-[var(--muted)]">{design.beads.length} 颗</span>
              </div>
              <div className="mt-4 max-h-[45vh] space-y-3 overflow-y-auto pr-1">
                {designSummary.map((item) => (
                  <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3" key={item.beadProductId}>
                    <span className="block h-10 w-10">
                      <CrystalBeadImage alt="" materialKey={item.materialKey} sizes="40px" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{item.name}</p>
                      <p className="mt-0.5 text-[0.68rem] text-[var(--muted)]">{item.diameterMm}mm · × {item.count}</p>
                    </div>
                    <span className="text-xs">
                      {formatMinorAmount({ amountMinor: item.unitPriceMinor * item.count, currency: design.currency, locale: design.locale })}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <div className="border-t border-[var(--border)]/70 pt-5">
              {order ? (
                <p className="mb-4 rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-center text-sm text-[var(--success)]" role="status">
                  设计已完成，订单快照已生成
                </p>
              ) : null}
              <div className="mb-5 flex items-center justify-between">
                <span className="font-medium">合计</span>
                <strong className="text-lg font-medium text-[var(--accent-deep)]">
                  {formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })}
                </strong>
              </div>
              <button
                className="min-h-12 w-full rounded-xl border border-[var(--accent)] text-sm text-[var(--accent-deep)] transition hover:bg-[var(--accent-soft)] disabled:opacity-45"
                disabled={isUpdating || design.beads.length <= 1}
                onClick={() => void clearDesign()}
                type="button"
              >
                清空设计
              </button>
              <button
                className="mt-3 min-h-16 w-full rounded-xl bg-[var(--accent-deep)] px-5 text-base font-semibold tracking-[0.08em] text-white shadow-[0_12px_30px_rgb(73_53_95/0.28)] transition hover:-translate-y-0.5 hover:bg-[var(--accent)] hover:shadow-[0_16px_34px_rgb(73_53_95/0.32)] disabled:translate-y-0 disabled:opacity-55"
                aria-describedby={braceletFit.canComplete ? undefined : "desktop-bracelet-fit-help"}
                disabled={isOrdering || Boolean(order) || !braceletFit.canComplete}
                onClick={() => void createOrder()}
                type="button"
              >
                {isOrdering ? "生成中…" : order ? "设计已完成" : "完成设计"}
              </button>
              {!braceletFit.canComplete ? (
                <p className="mt-2 text-center text-xs text-[var(--muted)]" id="desktop-bracelet-fit-help">
                  调整到 13.0–20.0cm 后即可完成
                </p>
              ) : null}
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden bg-[#fbf8f2] px-5 py-3" aria-labelledby="desktop-material-shelf-title">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg" id="desktop-material-shelf-title">珠子货架</h2>
              <span className="text-xs text-[var(--muted)]">点击即加入</span>
            </div>
            <div className="mt-2 flex gap-3 overflow-x-auto pb-2" aria-label="桌面可加入的珠子">
              {materialOptions.map((material, index) => (
                <button
                  aria-label={`加入 ${material.crystalNameCn}`}
                  className="group h-[8.75rem] w-[7.5rem] shrink-0 rounded-2xl border border-[var(--border)] bg-white/72 px-3 py-2 text-center transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-white disabled:cursor-wait disabled:opacity-55"
                  disabled={isUpdating}
                  key={material.beadProductId}
                  onClick={() => void addMaterial(material)}
                  type="button"
                >
                  <span className="mx-auto block h-14 w-14 transition-transform group-hover:scale-105">
                    <CrystalBeadImage alt="" materialKey={material.materialKey} priority={index < 6} sizes="56px" />
                  </span>
                  <span className="mt-1 block truncate text-sm font-medium">{material.crystalNameCn}</span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">{material.diameterMm}mm</span>
                  <span className="mt-1 block text-sm">
                    {formatMinorAmount({ amountMinor: material.unitPriceMinor, currency: design.currency, locale: design.locale })}
                  </span>
                </button>
              ))}
              {materialOptions.length === 0 ? (
                <p className="grid min-h-40 w-full place-items-center text-sm text-[var(--muted)]">没有符合条件的珠子，请调整筛选。</p>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <div className="lg:hidden sm:px-6 sm:py-6">
        <div className={DIY_LAYOUT_CLASS}>
        <section className="overflow-hidden bg-[var(--surface)] sm:rounded-[1.7rem] sm:border sm:border-[var(--border)] sm:shadow-[0_20px_65px_rgb(57_45_67/0.08)]" aria-labelledby="bracelet-preview-title">
          <header className="grid min-h-16 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-[var(--border)]/65 px-4 sm:px-6">
            <Link className="inline-flex min-h-11 items-center text-sm text-[var(--muted)] hover:text-[var(--accent)]" href={`/design/${encodeURIComponent(design.designId)}`}>← 返回</Link>
            <h1 className="font-serif text-xl sm:text-2xl" id="bracelet-preview-title">DIY 手串</h1>
            <div className="flex items-center justify-end gap-2 text-xs sm:text-sm">
              <span className="hidden rounded-full border border-[var(--border)] px-3 py-2 text-[var(--muted)] min-[390px]:inline">当前手围 {braceletFit.circumferenceCmLabel}cm</span>
              <strong className="rounded-full bg-[var(--accent-deep)] px-3 py-2 font-medium text-white">{formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })}</strong>
            </div>
          </header>

          {notice ? <div className="m-4"><FlowNotice code={notice} compact onAction={noticeAction} /></div> : null}
          {editMessage ? <p className="mx-4 mt-3 rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--success)]" role="status">{editMessage}</p> : null}

          <div className="px-2 pb-2 pt-1 sm:px-8" data-preview-region="large">
            <div className="flex justify-end px-2 pt-2">
              <button
                aria-pressed={braceletConnected}
                className="min-h-11 touch-manipulation rounded-full border border-[var(--accent)] bg-white/85 px-4 text-sm text-[var(--accent-deep)]"
                disabled={isUpdating}
                onClick={() => setBraceletConnected((current) => !current)}
                type="button"
              >
                {braceletConnected ? "散开查看" : "收缩成串"}
              </button>
            </div>
            <FlatBraceletEditor
              busy={isUpdating}
              connected={braceletConnected}
              design={design}
              fit={braceletFit}
              onMove={(componentId, targetPositionIndex) => void moveBead(componentId, targetPositionIndex)}
              onRemove={(componentId) => void removeBead(componentId)}
              onSelect={setSelectedComponentId}
              selectedComponentId={selectedComponentId}
            />
            <p className="-mt-2 pb-3 text-center text-xs tracking-[0.08em] text-[var(--muted)] sm:text-sm">点击加入 · 拖动换位 · 拖到中间删除</p>
          </div>

          <div className="grid min-h-16 grid-cols-3 items-center border-y border-[var(--border)]/70 bg-white/55 px-3 text-sm sm:px-6">
            <button className="min-h-11 justify-self-start px-2 text-[var(--muted)] disabled:opacity-35" disabled={!selectedBead || isUpdating || selectedBead.positionIndex === 0} onClick={() => moveSelectedBy(-1)} type="button">↶ 撤销</button>
            <button className="min-h-11 justify-self-center px-2 text-[var(--muted)] disabled:opacity-55" disabled={isSaving} onClick={() => void save()} type="button">{isSaving ? "保存中…" : savedAt ? "✓ 已保存" : "保存"}</button>
            <button aria-describedby={braceletFit.canComplete ? undefined : "mobile-bracelet-fit-help"} className="min-h-11 justify-self-end rounded-full bg-[var(--accent-deep)] px-4 text-white disabled:opacity-40 sm:px-7" disabled={isOrdering || Boolean(order) || !braceletFit.canComplete} onClick={() => void createOrder()} type="button">{isOrdering ? "生成中…" : order ? "设计已完成" : "完成设计"}</button>
          </div>
          {!braceletFit.canComplete ? <p className="border-b border-[var(--border)]/70 bg-white/55 px-4 pb-3 text-right text-xs text-[var(--muted)]" id="mobile-bracelet-fit-help">调整到 13.0–20.0cm 后即可完成</p> : null}

          <section className="bg-[var(--surface)] px-3 pb-5 pt-4 sm:px-6" aria-labelledby="material-library-title">
            <div className="flex items-end justify-between gap-3">
              <h2 className="font-serif text-xl sm:text-2xl" id="material-library-title">完整珠子库</h2>
              <span className="text-xs text-[var(--muted)]">{materialOptions.length}/{catalogMaterials.length} 款</span>
            </div>

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="珠子分类">
              {CATALOG_CATEGORIES.map((category) => (
                <button
                  aria-pressed={catalogCategory === category.id}
                  className={`min-h-11 shrink-0 rounded-xl border px-4 text-sm transition ${catalogCategory === category.id ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white" : "border-[var(--border)] bg-white/65 text-[var(--muted)] hover:border-[var(--accent)]"}`}
                  key={category.id}
                  onClick={() => setCatalogCategory(category.id)}
                  type="button"
                >
                  {category.label}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_5.7rem_5.7rem] gap-2">
              <label className="sr-only" htmlFor="catalog-search">搜索珠子</label>
              <input className="min-h-11 min-w-0 rounded-full border border-[var(--border)] bg-white/80 px-4 text-sm outline-none focus:border-[var(--accent)]" id="catalog-search" onChange={(event) => setCatalogQuery(event.target.value)} placeholder="搜索名称" type="search" value={catalogQuery} />
              <label className="sr-only" htmlFor="catalog-color">颜色</label>
              <select className="min-h-11 min-w-0 rounded-full border border-[var(--border)] bg-white/80 px-2 text-xs" id="catalog-color" onChange={(event) => setCatalogColor(event.target.value)} value={catalogColor}>
                <option value="ALL">颜色</option>
                {catalogColors.map((color) => <option key={color} value={color}>{COLOR_TAG_LABELS[color]}</option>)}
              </select>
              <label className="sr-only" htmlFor="catalog-diameter">尺寸</label>
              <select className="min-h-11 min-w-0 rounded-full border border-[var(--border)] bg-white/80 px-2 text-xs" id="catalog-diameter" onChange={(event) => setCatalogDiameter(event.target.value)} value={catalogDiameter}>
                <option value="ALL">尺寸</option>
                {catalogDiameters.map((diameter) => <option key={diameter} value={diameter}>{diameter}mm</option>)}
              </select>
            </div>

            <div className="mt-3 grid max-h-[36rem] grid-cols-3 gap-2 overflow-y-auto pr-0.5 sm:gap-3" aria-label="可加入的珠子">
              {materialOptions.map((material, index) => (
                <button
                  aria-label={`加入 ${material.crystalNameCn}`}
                  className="group min-h-40 min-w-0 rounded-2xl border border-[var(--border)] bg-white/58 p-2 text-center transition hover:border-[var(--accent)] hover:bg-white disabled:cursor-wait disabled:opacity-55 sm:p-3"
                  disabled={isUpdating}
                  key={material.beadProductId}
                  onClick={() => void addMaterial(material)}
                  type="button"
                >
                  <span className="mx-auto block h-16 w-16 transition-transform group-hover:scale-105 sm:h-20 sm:w-20">
                    <CrystalBeadImage alt="" materialKey={material.materialKey} priority={index < 6} sizes="80px" />
                  </span>
                  <span className="mt-1 block truncate text-xs font-medium sm:text-sm">{material.crystalNameCn}</span>
                  <span className="mt-1 block text-[0.68rem] text-[var(--muted)] sm:text-xs">{material.diameterMm}mm</span>
                  <span className="mt-1 block text-xs text-[var(--foreground)] sm:text-sm">{formatMinorAmount({ amountMinor: material.unitPriceMinor, currency: design.currency, locale: design.locale })}</span>
                </button>
              ))}
              {materialOptions.length === 0 ? <p className="col-span-3 rounded-2xl bg-[var(--surface-soft)] p-5 text-center text-sm text-[var(--muted)]">没有符合条件的珠子，请调整筛选。</p> : null}
            </div>
            {isUpdating ? <p className="mt-4 text-center text-sm text-[var(--muted)]" role="status">正在同步手串、库存与价格…</p> : null}
          </section>
        </section>

        {order ? (
          <section className="mt-4 rounded-2xl border border-[var(--success)]/30 bg-white/70 p-5" aria-labelledby="order-snapshot-title" data-order-id={order.orderId}>
            <h2 className="font-serif text-xl" id="order-snapshot-title">设计已确认，订单快照已生成（未接支付）</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{order.orderId} · Revision {order.snapshot.design.revision} · {formatMinorAmount({ amountMinor: order.snapshot.design.pricing.totalPriceMinor, currency: order.snapshot.design.currency, locale: order.snapshot.design.locale })}</p>
          </section>
        ) : null}

        <details className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <summary className="min-h-11 cursor-pointer text-sm text-[var(--muted)]">查看选中珠子与设计说明</summary>
          <div className="grid gap-5 pt-4 md:grid-cols-2">
            <section aria-labelledby="selected-component-title">
              <h2 className="font-serif text-xl" id="selected-component-title">选中珠子</h2>
              {selectedBead ? (
                <div className="mt-3">
                  <p className="text-sm">第 {selectedBead.positionIndex + 1} 颗 · {selectedBead.diameterMm}mm {selectedBead.shape}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <button className="min-h-11 rounded-xl border border-[var(--border)] text-sm disabled:opacity-35" disabled={isUpdating || selectedBead.positionIndex === 0} onClick={() => moveSelectedBy(-1)} type="button">左移</button>
                    <button className="min-h-11 rounded-xl border border-[var(--border)] text-sm disabled:opacity-35" disabled={isUpdating || selectedBead.positionIndex >= ringLength - 1} onClick={() => moveSelectedBy(1)} type="button">右移</button>
                    <button className="min-h-11 rounded-xl border border-[var(--danger)]/40 text-sm text-[var(--danger)] disabled:opacity-35" disabled={isUpdating || design.beads.length <= 1 || selectedAnchorsAccessory} onClick={() => void removeBead(selectedBead.componentId)} type="button">移除</button>
                  </div>
                </div>
              ) : <p className="mt-3 text-sm text-[var(--muted)]">请选择一颗珠子。</p>}
            </section>
            <section aria-labelledby="design-note-title">
              <h2 className="font-serif text-xl" id="design-note-title">设计说明 · {components.length} 个组件</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{design.story.designStory}</p>
              <div className="mt-4"><ComplianceNotice design={design} /></div>
            </section>
          </div>
        </details>
        </div>
      </div>
    </main>
  );
}
