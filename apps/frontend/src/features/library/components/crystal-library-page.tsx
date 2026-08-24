"use client";

import type {
  AccessoryV1,
  CatalogAccessoryProduct,
  CatalogMaterialProduct,
  PublicDesignV1
} from "@mystcrag/design-contract";
import Link from "next/link";
import * as React from "react";

import { FlowNotice } from "../../../components/flow-notice";
import { createAddRequest, createOperationsRequest, designApi } from "../../../lib/api/design-api";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import { CrystalBeadImage } from "../../design/components/crystal-bead-image";
import { formatMinorAmount } from "../../design/model/format-minor-amount";
import {
  accessoryDisplayNames,
  COLOR_SWATCHES,
  COLOR_TAG_LABELS,
  crystalCategoryOf,
  DEFAULT_LIBRARY_FILTER,
  filterAccessories,
  filterCrystalGroups,
  groupMaterialsByCrystal,
  PRODUCT_TYPE_LABELS,
  sortAccessories,
  sortCrystalGroups,
  VISUAL_TAG_LABELS,
  type CrystalGroup,
  type LibraryFilter,
  type LibraryProductType,
  type LibrarySortKey,
  type LibraryStockFilter
} from "../model/library-model";

const LIBRARY_DESIGN_ID = "design-diy-private";
const FAVORITES_STORAGE_KEY = "mystcrag:library-favorites";
const MATERIAL_LIST_COLLAPSED_COUNT = 9;
const PANEL_THUMBNAIL_LIMIT = 14;

const SORT_OPTIONS: Array<{ id: LibrarySortKey; label: string }> = [
  { id: "COMPREHENSIVE", label: "综合排序" },
  { id: "PRICE_ASC", label: "价格从低到高" },
  { id: "PRICE_DESC", label: "价格从高到低" },
  { id: "NAME", label: "名称" }
];

const STOCK_OPTIONS: Array<{ id: LibraryStockFilter; label: string }> = [
  { id: "IN_STOCK", label: "有库存" },
  { id: "RESTOCK", label: "需补货·约5天" },
  { id: "ALL", label: "全部" }
];

const PRODUCT_TYPES: LibraryProductType[] = ["CRYSTAL", "NATURAL_STONE", "ACCESSORY"];

function loadFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favorites]));
}

function AccessoryGlyph({ accessoryType }: { accessoryType: string }) {
  if (accessoryType === "PENDANT") {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 64" className="h-full w-full">
        <defs>
          <linearGradient id="pendant-metal" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#f2f1ec" />
            <stop offset="0.45" stopColor="#c9c7c1" />
            <stop offset="1" stopColor="#8f8d88" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="13" r="5" fill="none" stroke="url(#pendant-metal)" strokeWidth="3" />
        <path d="M32 22c9 8 12 14 12 20a12 12 0 0 1-24 0c0-6 3-12 12-20Z" fill="url(#pendant-metal)" />
        <path d="M28 40a4 4 0 0 0 8 0" fill="none" stroke="#fffdf8" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" className="h-full w-full">
      <defs>
        <linearGradient id="spacer-metal" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f2f1ec" />
          <stop offset="0.5" stopColor="#c9c7c1" />
          <stop offset="1" stopColor="#8f8d88" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="21" fill="url(#spacer-metal)" />
      <circle cx="32" cy="32" r="7" fill="#f7f5f0" stroke="#b9b7b2" strokeWidth="1.4" />
    </svg>
  );
}

export function CrystalLibraryPage() {
  const [design, setDesign] = React.useState<PublicDesignV1 | null>(null);
  const [materials, setMaterials] = React.useState<CatalogMaterialProduct[]>([]);
  const [accessories, setAccessories] = React.useState<CatalogAccessoryProduct[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [notice, setNotice] = React.useState<FrontendErrorCode | null>(null);
  const [message, setMessage] = React.useState("");
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [clearArmed, setClearArmed] = React.useState(false);

  const [filter, setFilter] = React.useState<LibraryFilter>(DEFAULT_LIBRARY_FILTER);
  const [sort, setSort] = React.useState<LibrarySortKey>("COMPREHENSIVE");
  const [materialListExpanded, setMaterialListExpanded] = React.useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);
  const [panelCollapsed, setPanelCollapsed] = React.useState(false);
  const [variantSelection, setVariantSelection] = React.useState<Record<string, string>>({});
  const [favorites, setFavorites] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    let active = true;
    void Promise.all([
      designApi.get(LIBRARY_DESIGN_ID),
      designApi.materials("CNY")
    ]).then(([designResponse, catalogResponse]) => {
      if (!active) return;
      setFavorites(loadFavorites());
      setDesign(designResponse);
      setMaterials(catalogResponse.materials);
      setAccessories(catalogResponse.accessories);
      setVariantSelection((current) => {
        const next: Record<string, string> = {};
        for (const material of catalogResponse.materials) {
          const existing = current[material.crystalId];
          next[material.crystalId] = typeof existing === "string" && catalogResponse.materials.some((candidate) => candidate.beadProductId === existing)
            ? existing
            : material.beadProductId;
        }
        return next;
      });
      setNotice(null);
    }).catch((error: unknown) => {
      if (!active) return;
      setNotice(toFrontendApiError(error).code);
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  const retryLoad = () => {
    setIsLoading(true);
    setNotice(null);
    void Promise.all([
      designApi.get(LIBRARY_DESIGN_ID),
      designApi.materials("CNY")
    ]).then(([designResponse, catalogResponse]) => {
      setDesign(designResponse);
      setMaterials(catalogResponse.materials);
      setAccessories(catalogResponse.accessories);
      setNotice(null);
    }).catch((error: unknown) => {
      setNotice(toFrontendApiError(error).code);
    }).finally(() => setIsLoading(false));
  };

  const allGroups = React.useMemo(() => groupMaterialsByCrystal(materials), [materials]);
  const categoryGroups = React.useMemo(
    () => allGroups.filter((group) => crystalCategoryOf(group) === filter.productType),
    [allGroups, filter.productType]
  );
  const filteredGroups = React.useMemo(
    () => sortCrystalGroups(filterCrystalGroups(allGroups, filter), sort),
    [allGroups, filter, sort]
  );
  const filteredAccessories = React.useMemo(
    () => sortAccessories(filterAccessories(accessories, filter), sort),
    [accessories, filter, sort]
  );

  const availableDiameters = React.useMemo(
    () => [...new Set(categoryGroups.flatMap((group) => group.variants.map((variant) => variant.diameterMm)))].sort((left, right) => left - right),
    [categoryGroups]
  );
  const availableColors = React.useMemo(
    () => [...new Set(categoryGroups.flatMap((group) => group.variants.flatMap((variant) => variant.colorTags)))]
      .filter((tag) => tag in COLOR_TAG_LABELS)
      .sort(),
    [categoryGroups]
  );
  const availableVisualTags = React.useMemo(
    () => [...new Set(categoryGroups.flatMap((group) => group.variants.flatMap((variant) => variant.visualTags)))]
      .filter((tag) => tag in VISUAL_TAG_LABELS)
      .sort(),
    [categoryGroups]
  );

  const totalCount = filter.productType === "ACCESSORY" ? filteredAccessories.length : filteredGroups.length;

  const toggleFavorite = (productId: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      saveFavorites(next);
      return next;
    });
  };

  const applyUpdate = async (
    request: ReturnType<typeof createOperationsRequest>,
    successMessage: string
  ) => {
    if (!design) return;
    setIsUpdating(true);
    setNotice(null);
    setMessage("");
    setSavedAt(null);
    try {
      const response = await designApi.update(request);
      setDesign(response.design);
      setMessage(successMessage);
    } catch (error) {
      setNotice(toFrontendApiError(error).code);
    } finally {
      setIsUpdating(false);
    }
  };

  const addMaterial = async (material: CatalogMaterialProduct) => {
    if (!design) return;
    await applyUpdate(
      createAddRequest(design, material, design.production.componentSequence.length),
      `已加入 ${material.crystalNameCn} ${material.diameterMm}mm`
    );
  };

  const addAccessory = async (accessory: CatalogAccessoryProduct) => {
    if (!design) return;
    const componentId = `accessory-${crypto.randomUUID()}`;
    let component: AccessoryV1;
    if (accessory.accessoryType === "PENDANT") {
      const anchor = design.beads[0];
      if (!anchor) {
        setMessage("请先在手串中加入珠子，再添加吊坠。");
        return;
      }
      component = {
        componentId,
        accessoryType: "PENDANT",
        accessoryProductId: accessory.accessoryProductId,
        material: accessory.material,
        finish: accessory.finish,
        dimensions: { widthMm: 5, heightMm: 8, depthMm: 2 },
        quantity: 1,
        unitPriceMinor: accessory.unitPriceMinor,
        modelAssetKey: "pendant-drop-silver-8mm-v1",
        placementMode: "ANCHORED",
        anchorComponentId: anchor.componentId,
        anchorSlot: 0
      };
    } else {
      component = {
        componentId,
        accessoryType: "SPACER",
        accessoryProductId: accessory.accessoryProductId,
        material: accessory.material,
        finish: accessory.finish,
        dimensions: { widthMm: 2, diameterMm: 3 },
        quantity: 1,
        unitPriceMinor: accessory.unitPriceMinor,
        modelAssetKey: "spacer-silver-3mm-v1",
        placementMode: "INLINE",
        positionIndex: design.production.componentSequence.length
      };
    }
    const names = accessoryDisplayNames(accessory);
    await applyUpdate(createOperationsRequest(design, [{ operation: "ADD_COMPONENT", component }]), `已加入${names.nameCn}`);
  };

  const saveDesign = async () => {
    if (!design) return;
    setIsSaving(true);
    setNotice(null);
    try {
      const response = await designApi.save(design);
      setDesign(response.design);
      setSavedAt(response.savedAt);
      setMessage("设计已保存。");
    } catch (error) {
      setNotice(toFrontendApiError(error).code);
    } finally {
      setIsSaving(false);
    }
  };

  const clearDesign = async () => {
    if (!design) return;
    if (!clearArmed) {
      setClearArmed(true);
      window.setTimeout(() => setClearArmed(false), 3500);
      return;
    }
    setClearArmed(false);
    if (design.beads.length <= 1) {
      setMessage("当前设计仅有一颗珠子。");
      return;
    }
    const protectedAnchor = design.accessories.find((accessory) => accessory.placementMode === "ANCHORED")?.anchorComponentId;
    const keepComponentId = design.beads.find((bead) => bead.componentId === protectedAnchor)?.componentId ?? design.beads[0]?.componentId;
    const removableBeads = [...design.beads]
      .filter((bead) => bead.componentId !== keepComponentId)
      .sort((left, right) => right.positionIndex - left.positionIndex);
    await applyUpdate(
      createOperationsRequest(design, removableBeads.map((bead) => ({ operation: "REMOVE_COMPONENT" as const, componentId: bead.componentId }))),
      "设计已清空，仅保留一颗基础珠子。"
    );
  };

  const resetFilters = () => {
    setFilter((current) => ({ ...DEFAULT_LIBRARY_FILTER, productType: current.productType }));
    setSort("COMPREHENSIVE");
    setMaterialListExpanded(false);
  };

  const hasActiveFilter =
    filter.crystalId !== "ALL" || filter.diameterMm !== "ALL" || filter.colorTag !== "ALL" ||
    filter.visualTag !== "ALL" || filter.stock !== "IN_STOCK" || filter.query.trim().length > 0;

  const selectedVariantOf = (group: CrystalGroup): CatalogMaterialProduct => {
    const selectedId = variantSelection[group.crystalId];
    return group.variants.find((variant) => variant.beadProductId === selectedId) ?? group.variants[0]!;
  };

  const currency = design?.currency ?? "CNY";
  const locale = design?.locale ?? "zh-CN";
  const materialList = materialListExpanded ? categoryGroups : categoryGroups.slice(0, MATERIAL_LIST_COLLAPSED_COUNT);

  const renderProductGrid = () => {
    if (filter.productType === "ACCESSORY") {
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4" data-library-grid="ACCESSORY">
          {filteredAccessories.map((accessory) => {
            const names = accessoryDisplayNames(accessory);
            const isFavorite = favorites.has(accessory.accessoryProductId);
            const restock = accessory.availableQuantity === 0;
            return (
              <article className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white" data-library-card={accessory.accessoryProductId} key={accessory.accessoryProductId}>
                <div className="relative grid aspect-square place-items-center bg-[#f5f4f2] p-6">
                  <span className="block h-20 w-20 lg:h-24 lg:w-24"><AccessoryGlyph accessoryType={accessory.accessoryType} /></span>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3 lg:p-4">
                  <div>
                    <h3 className="truncate text-sm font-medium">{names.nameCn}</h3>
                    <p className="truncate text-xs text-[var(--muted)]">{names.nameEn}</p>
                  </div>
                  <p className="text-sm font-medium text-[var(--accent-deep)]">
                    {formatMinorAmount({ amountMinor: accessory.unitPriceMinor, currency, locale })}<span className="ml-0.5 text-xs font-normal text-[var(--muted)]">/件</span>
                  </p>
                  <p className={`text-xs ${restock ? "text-amber-700" : "text-[var(--muted)]"}`}>{restock ? "需补货·约5天" : "有库存"}</p>
                  <div className="mt-auto flex items-center gap-2">
                    <button
                      aria-label={isFavorite ? `取消收藏${names.nameCn}` : `收藏${names.nameCn}`}
                      aria-pressed={isFavorite}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--border)] transition hover:border-[var(--accent)]"
                      onClick={() => toggleFavorite(accessory.accessoryProductId)}
                      type="button"
                    >
                      <svg aria-hidden="true" fill={isFavorite ? "var(--danger)" : "none"} height="18" stroke={isFavorite ? "var(--danger)" : "currentColor"} strokeWidth="1.6" viewBox="0 0 24 24" width="18">
                        <path d="M12 20.3 4.9 13.4a4.6 4.6 0 0 1 6.5-6.5l.6.6.6-.6a4.6 4.6 0 0 1 6.5 6.5Z" />
                      </svg>
                    </button>
                    <button
                      className="min-h-11 flex-1 rounded-xl bg-[var(--accent-deep)] text-sm text-white transition hover:bg-[var(--accent)] disabled:opacity-55"
                      disabled={isUpdating}
                      onClick={() => void addAccessory(accessory)}
                      type="button"
                    >
                      加入设计
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          {filteredAccessories.length === 0 ? (
            <p className="col-span-full rounded-2xl bg-[var(--surface-soft)] p-6 text-center text-sm text-[var(--muted)]" data-library-empty="true">没有符合条件的配饰，请调整筛选。</p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5" data-library-grid={filter.productType}>
        {filteredGroups.map((group, index) => {
          const variant = selectedVariantOf(group);
          const isFavorite = favorites.has(variant.beadProductId);
          const restock = variant.availableQuantity === 0;
          return (
            <article className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white transition hover:border-[var(--accent)]/60 hover:shadow-[0_10px_28px_rgb(57_45_67/0.08)]" data-library-card={group.crystalId} key={group.crystalId}>
              <div className="relative grid aspect-square place-items-center bg-[#f5f4f2] p-5 lg:p-6">
                <span className="block h-[76%] w-[76%]">
                  <CrystalBeadImage alt={`${group.nameCn}珠子照片`} materialKey={variant.materialKey} priority={index < 5} sizes="(max-width: 1024px) 45vw, 180px" />
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3 lg:p-4">
                <div>
                  <h3 className="truncate text-sm font-medium">{group.nameCn}</h3>
                  <p className="truncate text-xs text-[var(--muted)]">{group.nameEn}</p>
                </div>
                {group.variants.length > 1 ? (
                  <label className="block">
                    <span className="sr-only">{group.nameCn}直径</span>
                    <select
                      className="min-h-9 w-full rounded-lg border border-[var(--border)] bg-white px-2 text-xs text-[var(--muted)]"
                      onChange={(event) => setVariantSelection((current) => ({ ...current, [group.crystalId]: event.target.value }))}
                      value={variant.beadProductId}
                    >
                      {group.variants.map((option) => (
                        <option key={option.beadProductId} value={option.beadProductId}>
                          {option.diameterMm}mm{option.shape === "FACETED" ? " 切面" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-xs text-[var(--muted)]">{variant.diameterMm}mm{variant.shape === "FACETED" ? " 切面" : ""}</p>
                )}
                <p className="text-sm font-medium text-[var(--accent-deep)]">
                  {formatMinorAmount({ amountMinor: variant.unitPriceMinor, currency, locale })}<span className="ml-0.5 text-xs font-normal text-[var(--muted)]">/颗</span>
                </p>
                <p className={`text-xs ${restock ? "text-amber-700" : "text-[var(--muted)]"}`}>{restock ? "需补货·约5天" : "有库存"}</p>
                <div className="mt-auto flex items-center gap-2">
                  <button
                    aria-label={isFavorite ? `取消收藏${group.nameCn}` : `收藏${group.nameCn}`}
                    aria-pressed={isFavorite}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--border)] transition hover:border-[var(--accent)]"
                    onClick={() => toggleFavorite(variant.beadProductId)}
                    type="button"
                  >
                    <svg aria-hidden="true" fill={isFavorite ? "var(--danger)" : "none"} height="18" stroke={isFavorite ? "var(--danger)" : "currentColor"} strokeWidth="1.6" viewBox="0 0 24 24" width="18">
                      <path d="M12 20.3 4.9 13.4a4.6 4.6 0 0 1 6.5-6.5l.6.6.6-.6a4.6 4.6 0 0 1 6.5 6.5Z" />
                    </svg>
                  </button>
                  <button
                    className="min-h-11 flex-1 rounded-xl bg-[var(--accent-deep)] text-sm text-white transition hover:bg-[var(--accent)] disabled:opacity-55"
                    disabled={isUpdating}
                    onClick={() => void addMaterial(variant)}
                    type="button"
                  >
                    加入设计
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {filteredGroups.length === 0 ? (
          <p className="col-span-full rounded-2xl bg-[var(--surface-soft)] p-6 text-center text-sm text-[var(--muted)]" data-library-empty="true">没有符合条件的矿石，请调整筛选。</p>
        ) : null}
      </div>
    );
  };

  const renderFilterSections = (variant: "desktop" | "mobile") => (
    <>
      <section aria-labelledby={`library-material-${variant}-title`}>
        <h3 className="text-sm font-medium" id={`library-material-${variant}-title`}>材质</h3>
        <ul className="mt-2 space-y-0.5">
          <li>
            <button
              aria-pressed={filter.crystalId === "ALL"}
              className={`flex min-h-10 w-full items-center justify-between rounded-lg px-2.5 text-left text-sm transition ${filter.crystalId === "ALL" ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-deep)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)]"}`}
              onClick={() => setFilter((current) => ({ ...current, crystalId: "ALL" }))}
              type="button"
            >
              <span>全部{PRODUCT_TYPE_LABELS[filter.productType] === "配饰" ? "配饰" : "材质"}</span>
              <span className="text-xs opacity-70">{filter.productType === "ACCESSORY" ? accessories.length : categoryGroups.length}</span>
            </button>
          </li>
          {materialList.map((group) => {
            const active = filter.crystalId === group.crystalId;
            return (
              <li key={group.crystalId}>
                <button
                  aria-pressed={active}
                  className={`flex min-h-10 w-full items-center justify-between rounded-lg px-2.5 text-left text-sm transition ${active ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-deep)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)]"}`}
                  onClick={() => setFilter((current) => ({ ...current, crystalId: active ? "ALL" : group.crystalId }))}
                  type="button"
                >
                  <span className="truncate">{group.nameCn}</span>
                  <span className="text-xs opacity-70">{group.variants.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {categoryGroups.length > MATERIAL_LIST_COLLAPSED_COUNT ? (
          <button
            className="mt-1 min-h-10 w-full rounded-lg px-2.5 text-left text-xs text-[var(--accent)] hover:bg-[var(--surface-soft)]"
            onClick={() => setMaterialListExpanded((current) => !current)}
            type="button"
          >
            {materialListExpanded ? "收起列表" : "展开更多"}
          </button>
        ) : null}
      </section>

      <section aria-labelledby={`library-size-${variant}-title`}>
        <h3 className="text-sm font-medium" id={`library-size-${variant}-title`}>尺寸</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {availableDiameters.map((diameter) => {
            const active = filter.diameterMm === diameter;
            return (
              <button
                aria-pressed={active}
                className={`min-h-9 rounded-full border px-3 text-xs transition ${active ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white" : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]"}`}
                key={diameter}
                onClick={() => setFilter((current) => ({ ...current, diameterMm: active ? "ALL" : diameter }))}
                type="button"
              >
                {diameter}mm
              </button>
            );
          })}
          {availableDiameters.length === 0 ? <p className="text-xs text-[var(--muted)]">当前品类无尺寸筛选项。</p> : null}
        </div>
      </section>

      <section aria-labelledby={`library-color-${variant}-title`}>
        <h3 className="text-sm font-medium" id={`library-color-${variant}-title`}>色彩</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {availableColors.map((color) => {
            const active = filter.colorTag === color;
            return (
              <button
                aria-label={`按${COLOR_TAG_LABELS[color]}筛选`}
                aria-pressed={active}
                className={`grid h-9 w-9 place-items-center rounded-full border-2 transition ${active ? "border-[var(--accent-deep)]" : "border-transparent hover:border-[var(--border)]"}`}
                key={color}
                onClick={() => setFilter((current) => ({ ...current, colorTag: active ? "ALL" : color }))}
                type="button"
              >
                <span className="h-6 w-6 rounded-full border border-black/8" style={{ background: COLOR_SWATCHES[color] }} />
              </button>
            );
          })}
          {availableColors.length === 0 ? <p className="text-xs text-[var(--muted)]">当前品类无色彩筛选项。</p> : null}
        </div>
      </section>

      <section aria-labelledby={`library-style-${variant}-title`}>
        <h3 className="text-sm font-medium" id={`library-style-${variant}-title`}>视觉风格</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {availableVisualTags.map((tag) => {
            const active = filter.visualTag === tag;
            return (
              <button
                aria-pressed={active}
                className={`min-h-9 rounded-full border px-3 text-xs transition ${active ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white" : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]"}`}
                key={tag}
                onClick={() => setFilter((current) => ({ ...current, visualTag: active ? "ALL" : tag }))}
                type="button"
              >
                {VISUAL_TAG_LABELS[tag]}
              </button>
            );
          })}
          {availableVisualTags.length === 0 ? <p className="text-xs text-[var(--muted)]">当前品类无风格筛选项。</p> : null}
        </div>
      </section>

      <section aria-labelledby={`library-stock-${variant}-title`}>
        <h3 className="text-sm font-medium" id={`library-stock-${variant}-title`}>库存状态</h3>
        <div className="mt-2 space-y-1">
          {STOCK_OPTIONS.map((option) => (
            <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm text-[var(--muted)]" key={option.id}>
              <input
                checked={filter.stock === option.id}
                className="h-4 w-4 accent-[var(--accent-deep)]"
                name={`library-stock-${variant}`}
                onChange={() => setFilter((current) => ({ ...current, stock: option.id }))}
                type="radio"
                value={option.id}
              />
              {option.label}
            </label>
          ))}
        </div>
      </section>

      <button
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] text-sm text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
        onClick={resetFilters}
        type="button"
      >
        <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
          <path d="M4.5 8.5a8 8 0 1 1-.6 6" />
          <path d="M4 3.5v5h5" />
        </svg>
        重置筛选
      </button>
    </>
  );

  if (isLoading) {
    return (
      <main className="mx-auto grid min-h-[60vh] max-w-7xl place-items-center px-5 py-16" data-library-page="loading" aria-live="polite">
        <p className="text-sm text-[var(--muted)]">正在从 Backend 加载矿石目录与当前设计…</p>
      </main>
    );
  }

  if (!design) {
    return (
      <main className="mx-auto min-h-[60vh] max-w-3xl px-5 py-16" data-library-page="error">
        <FlowNotice code={notice ?? "EMPTY_STATE"} onAction={retryLoad} />
      </main>
    );
  }

  const sortedBeads = [...design.beads].sort((left, right) => left.positionIndex - right.positionIndex);
  const hiddenBeadCount = Math.max(0, sortedBeads.length - PANEL_THUMBNAIL_LIMIT);

  return (
    <main className="min-h-screen bg-[var(--surface)]" data-library-page="ready">
      <div className="mx-auto max-w-[92.5rem] px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        <header className="lg:hidden">
          <h1 className="font-serif text-2xl">矿石库</h1>
          <p className="mt-1 text-xs text-[var(--muted)]">按材质、色彩与尺寸寻找你的下一颗珠子</p>
        </header>

        <div className="mt-5 grid gap-6 lg:mt-0 lg:grid-cols-[14rem_minmax(0,1fr)_14.5rem] lg:gap-7">
          <aside className="hidden lg:block">
            <div className="sticky top-[4.5rem] space-y-5 rounded-2xl border border-[var(--border)] bg-white/70 p-4" data-library-filters="desktop">
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--border)] bg-white p-1" aria-label="商品品类">
                {PRODUCT_TYPES.map((type) => (
                  <button
                    aria-pressed={filter.productType === type}
                    className={`min-h-9 rounded-lg px-1 text-xs transition ${filter.productType === type ? "bg-[var(--accent-deep)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-soft)]"}`}
                    key={type}
                    onClick={() => setFilter({ ...DEFAULT_LIBRARY_FILTER, productType: type })}
                    type="button"
                  >
                    {PRODUCT_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
              {renderFilterSections("desktop")}
            </div>
          </aside>

          <section aria-labelledby="library-main-title" className="min-w-0">
            <div className="hidden lg:block">
              <h1 className="font-serif text-3xl" id="library-main-title">矿石库 <span className="text-base tracking-[0.12em] text-[var(--muted)]">Crystal Library</span></h1>
              <p className="mt-1.5 text-sm text-[var(--muted)]">按材质、色彩与尺寸寻找你的下一颗珠子</p>
            </div>

            <div className="mt-4 flex items-center gap-2 lg:mt-5">
              <label className="sr-only" htmlFor="library-search">搜索矿石</label>
              <div className="relative min-w-0 flex-1">
                <svg aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" fill="none" height="16" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="16">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m16.5 16.5 4 4" strokeLinecap="round" />
                </svg>
                <input
                  className="min-h-11 w-full rounded-full border border-[var(--border)] bg-white pl-10 pr-4 text-sm outline-none transition focus:border-[var(--accent)]"
                  id="library-search"
                  onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
                  placeholder="搜索矿石名称、矿物、颜色…"
                  type="search"
                  value={filter.query}
                />
              </div>
              <label className="sr-only" htmlFor="library-sort">排序方式</label>
              <select
                className="min-h-11 rounded-full border border-[var(--border)] bg-white px-3 text-sm text-[var(--muted)]"
                id="library-sort"
                onChange={(event) => setSort(event.target.value as LibrarySortKey)}
                value={sort}
              >
                {SORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <button
                aria-expanded={mobileFiltersOpen}
                className="flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-4 text-sm text-[var(--muted)] lg:hidden"
                onClick={() => setMobileFiltersOpen((current) => !current)}
                type="button"
              >
                <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
                  <path d="M4 7h16M7 12h10M10 17h4" strokeLinecap="round" />
                </svg>
                筛选
              </button>
              <p className="hidden shrink-0 text-sm text-[var(--muted)] lg:block" aria-live="polite">共 {totalCount} 件</p>
            </div>

            {mobileFiltersOpen ? (
              <div className="mt-3 space-y-4 rounded-2xl border border-[var(--border)] bg-white p-4 lg:hidden" data-library-filters="mobile">
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--border)] bg-white p-1" aria-label="商品品类">
                  {PRODUCT_TYPES.map((type) => (
                    <button
                      aria-pressed={filter.productType === type}
                      className={`min-h-9 rounded-lg px-1 text-xs transition ${filter.productType === type ? "bg-[var(--accent-deep)] text-white" : "text-[var(--muted)]"}`}
                      key={type}
                      onClick={() => setFilter({ ...DEFAULT_LIBRARY_FILTER, productType: type })}
                      type="button"
                    >
                      {PRODUCT_TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>
                {renderFilterSections("mobile")}
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="材质快捷筛选">
                <button
                  aria-pressed={filter.crystalId === "ALL"}
                  className={`min-h-9 shrink-0 rounded-full border px-3.5 text-xs transition ${filter.crystalId === "ALL" ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white" : "border-[var(--border)] bg-white text-[var(--muted)]"}`}
                  onClick={() => setFilter((current) => ({ ...current, crystalId: "ALL" }))}
                  type="button"
                >
                  全部
                </button>
                {categoryGroups.map((group) => (
                  <button
                    aria-pressed={filter.crystalId === group.crystalId}
                    className={`min-h-9 shrink-0 rounded-full border px-3.5 text-xs transition ${filter.crystalId === group.crystalId ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white" : "border-[var(--border)] bg-white text-[var(--muted)]"}`}
                    key={group.crystalId}
                    onClick={() => setFilter((current) => ({ ...current, crystalId: group.crystalId }))}
                    type="button"
                  >
                    {group.nameCn}
                  </button>
                ))}
              </div>
            )}

            {hasActiveFilter ? (
              <p className="mt-2 text-xs text-[var(--muted)] lg:hidden" aria-live="polite">共 {totalCount} 件</p>
            ) : null}

            {notice ? <div className="mt-4"><FlowNotice code={notice} compact onAction={() => setNotice(null)} /></div> : null}
            {message ? (
              <p className="mt-4 rounded-full bg-[var(--accent-soft)] px-5 py-2 text-sm text-[var(--success)]" role="status" data-library-toast="true">{message}</p>
            ) : null}

            <div className="mt-4 lg:mt-5">{renderProductGrid()}</div>
          </section>

          <aside className="hidden lg:block">
            <div className="sticky top-[4.5rem] rounded-2xl border border-[var(--border)] bg-white p-4" data-current-design-panel="desktop">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">当前设计</h2>
                <button
                  aria-expanded={!panelCollapsed}
                  aria-label={panelCollapsed ? "展开当前设计面板" : "收起当前设计面板"}
                  className="grid h-9 w-9 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--surface-soft)]"
                  onClick={() => setPanelCollapsed((current) => !current)}
                  type="button"
                >
                  <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" viewBox="0 0 24 24" width="14">
                    <path d={panelCollapsed ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"} />
                  </svg>
                </button>
              </div>
              <Link className="mt-1 inline-flex min-h-9 items-center text-xs text-[var(--accent)]" href={`/diy/${encodeURIComponent(design.designId)}`}>查看全部 ›</Link>

              {!panelCollapsed ? (
                <div className="mt-3">
                  <p className="text-xs text-[var(--muted)]">已选珠子（{design.beads.length}）</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sortedBeads.slice(0, PANEL_THUMBNAIL_LIMIT).map((bead) => (
                      <span className="block h-8 w-8" key={bead.componentId}>
                        <CrystalBeadImage alt="" materialKey={bead.materialKey} sizes="32px" />
                      </span>
                    ))}
                    {hiddenBeadCount > 0 ? <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--surface-soft)] text-[0.6rem] text-[var(--muted)]">+{hiddenBeadCount}</span> : null}
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3">
                    <span className="text-sm">材料总价</span>
                    <strong className="font-serif text-xl text-[var(--accent-deep)]">
                      {formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency, locale })}
                    </strong>
                  </div>
                </div>
              ) : null}

              <Link
                className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-[var(--accent-deep)] text-sm font-medium tracking-[0.06em] text-white shadow-[0_12px_30px_rgb(73_53_95/0.24)] transition hover:bg-[var(--accent)]"
                href={`/diy/${encodeURIComponent(design.designId)}`}
              >
                进入 DIY
              </Link>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-55"
                  disabled={isSaving}
                  onClick={() => void saveDesign()}
                  type="button"
                >
                  <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" width="14">
                    <path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-3.2L6 20V4.5a1 1 0 0 1 1-1Z" />
                  </svg>
                  {isSaving ? "保存中…" : savedAt ? "已保存" : "保存设计"}
                </button>
                <button
                  className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--danger)]/30 text-xs text-[var(--danger)] transition hover:bg-[#f8edef] disabled:opacity-55"
                  disabled={isUpdating || design.beads.length <= 1}
                  onClick={() => void clearDesign()}
                  type="button"
                >
                  <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" width="14">
                    <path d="M4 6.5h16M9 6.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5M6.5 6.5 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5" strokeLinecap="round" />
                  </svg>
                  {clearArmed ? "确认清空" : "清空设计"}
                </button>
              </div>
              <p className="mt-3 text-[0.68rem] leading-5 text-[var(--muted)]">*价格仅供参考，实际以结算为准</p>
            </div>
          </aside>
        </div>
      </div>

      <div className="sticky bottom-[3.4rem] z-40 border-t border-[var(--border)] bg-white/97 backdrop-blur-xl lg:hidden" data-current-design-panel="mobile">
        <div className="mx-auto flex max-w-[92.5rem] items-center gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-1">
            {sortedBeads.slice(0, 5).map((bead) => (
              <span className="block h-6 w-6 shrink-0" key={bead.componentId}>
                <CrystalBeadImage alt="" materialKey={bead.materialKey} sizes="24px" />
              </span>
            ))}
            {sortedBeads.length > 5 ? <span className="text-xs text-[var(--muted)]">…</span> : null}
          </div>
          <p className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">
            已选 {design.beads.length} 颗 · <strong className="font-medium text-[var(--foreground)]">{formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency, locale })}</strong>
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              aria-label="保存设计"
              className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--border)] text-[var(--muted)] transition hover:border-[var(--accent)] disabled:opacity-55"
              disabled={isSaving}
              onClick={() => void saveDesign()}
              type="button"
            >
              <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" width="16">
                <path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-3.2L6 20V4.5a1 1 0 0 1 1-1Z" />
              </svg>
            </button>
            <Link
              className="flex min-h-11 items-center rounded-xl bg-[var(--accent-deep)] px-5 text-sm font-medium text-white"
              href={`/diy/${encodeURIComponent(design.designId)}`}
            >
              进入DIY
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
