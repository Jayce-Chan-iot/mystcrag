"use client";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import Link from "next/link";
import * as React from "react";

import { FlowNotice } from "../../../components/flow-notice";
import { designApi } from "../../../lib/api/design-api";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import { CrystalBeadImage } from "../../design/components/crystal-bead-image";
import { formatMinorAmount } from "../../design/model/format-minor-amount";
import { getBeadVisual } from "../../design/model/visual-assets";
import {
  detailRouteFor,
  editorRouteFor,
  filterGalleryEntries,
  formatGalleryUpdatedAt,
  gallerySourceLabel,
  galleryStats,
  GALLERY_FILTER_OPTIONS,
  statusLabelFor,
  type GalleryEntry,
  type GalleryFilterId
} from "../model/gallery-model";

const FEATURED_BEAD_LIMIT = 14;
const CARD_BEAD_LIMIT = 7;
const EXPORT_CARD_WIDTH = 1200;
const EXPORT_CARD_HEIGHT = 630;

function sortedBeads(design: PublicDesignV1) {
  return [...design.beads].sort((left, right) => left.positionIndex - right.positionIndex);
}

function BeadStrip({
  beads,
  total,
  limit,
  beadClass
}: {
  beads: ReadonlyArray<PublicDesignV1["beads"][number]>;
  total: number;
  limit: number;
  beadClass: string;
}) {
  const visible = beads.slice(0, limit);
  const hidden = Math.max(0, total - visible.length);
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {visible.map((bead) => (
        <span className={`block ${beadClass}`} key={bead.componentId}>
          <CrystalBeadImage alt="" materialKey={bead.materialKey} sizes="96px" />
        </span>
      ))}
      {hidden > 0 ? (
        <span className={`grid place-items-center rounded-full bg-white/90 text-[0.65rem] text-[var(--muted)] ${beadClass}`}>+{hidden}</span>
      ) : null}
    </div>
  );
}

function loadExportImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`导出失败：无法加载 ${src}`));
    image.src = src;
  });
}

async function exportDesignCard(entry: GalleryEntry): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_CARD_WIDTH;
  canvas.height = EXPORT_CARD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("导出失败：当前浏览器不支持画布。");

  context.fillStyle = "#f8f5f0";
  context.fillRect(0, 0, EXPORT_CARD_WIDTH, EXPORT_CARD_HEIGHT);
  context.fillStyle = "#ffffff";
  context.fillRect(48, 48, EXPORT_CARD_WIDTH - 96, EXPORT_CARD_HEIGHT - 96);

  const beads = sortedBeads(entry.design).slice(0, 9);
  const images = await Promise.all(
    beads.map((bead) => loadExportImage(getBeadVisual(bead.materialKey).src))
  );
  const beadSize = 118;
  const gap = 14;
  const totalWidth = images.length * beadSize + Math.max(0, images.length - 1) * gap;
  let x = (EXPORT_CARD_WIDTH - totalWidth) / 2;
  const centerY = 300;
  for (const image of images) {
    context.save();
    context.shadowColor = "rgba(57, 45, 67, 0.18)";
    context.shadowBlur = 16;
    context.shadowOffsetY = 6;
    context.drawImage(image, x, centerY - beadSize / 2, beadSize, beadSize);
    context.restore();
    x += beadSize + gap;
  }

  context.fillStyle = "#241b2e";
  context.textAlign = "center";
  context.font = '600 52px "Songti SC", "Noto Serif SC", serif';
  context.fillText(entry.design.designName, EXPORT_CARD_WIDTH / 2, 480);
  context.fillStyle = "#7a7285";
  context.font = '400 28px "PingFang SC", sans-serif';
  const wristCm = (entry.design.bracelet.wristCircumferenceMm / 10).toFixed(1);
  context.fillText(
    `手围 ${wristCm} cm · ${gallerySourceLabel(entry.design)} · ${statusLabelFor(entry.status)}`,
    EXPORT_CARD_WIDTH / 2,
    538
  );

  const link = document.createElement("a");
  link.download = `mystcrag-${entry.design.designId}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  return `已导出「${entry.design.designName}」设计图`;
}

export function GalleryPage() {
  const [entries, setEntries] = React.useState<GalleryEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [notice, setNotice] = React.useState<FrontendErrorCode | null>(null);
  const [message, setMessage] = React.useState("");
  const [filterId, setFilterId] = React.useState<GalleryFilterId>("ALL");
  const [query, setQuery] = React.useState("");
  const [busyDesignId, setBusyDesignId] = React.useState<string | null>(null);
  const [deleteArmedId, setDeleteArmedId] = React.useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = React.useState<string | null>(null);

  const loadEntries = React.useCallback(() => {
    return designApi.listDesigns()
      .then((response) => {
        setEntries([...response.designs].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)));
        setNotice(null);
      })
      .catch((error: unknown) => {
        setNotice(toFrontendApiError(error).code);
      });
  }, []);

  React.useEffect(() => {
    let active = true;
    void designApi.listDesigns()
      .then((response) => {
        if (!active) return;
        setEntries([...response.designs].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)));
        setNotice(null);
      })
      .catch((error: unknown) => {
        if (active) setNotice(toFrontendApiError(error).code);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  React.useEffect(() => {
    if (!deleteArmedId) return;
    const timer = window.setTimeout(() => setDeleteArmedId(null), 3500);
    return () => window.clearTimeout(timer);
  }, [deleteArmedId]);

  const stats = React.useMemo(() => galleryStats(entries), [entries]);
  const filtered = React.useMemo(() => filterGalleryEntries(entries, filterId, query), [entries, filterId, query]);
  const [featured, ...rest] = filtered;

  const runEntryAction = async (entry: GalleryEntry, action: () => Promise<string>) => {
    setBusyDesignId(entry.design.designId);
    setMenuOpenId(null);
    setNotice(null);
    try {
      setMessage(await action());
    } catch (error) {
      setNotice(toFrontendApiError(error).code);
    } finally {
      setBusyDesignId(null);
    }
  };

  const cloneEntry = (entry: GalleryEntry) => runEntryAction(entry, async () => {
    await designApi.cloneDesign(entry.design.designId, entry.design.revision);
    await loadEntries();
    return `已复制「${entry.design.designName}」`;
  });

  const deleteEntry = (entry: GalleryEntry) => runEntryAction(entry, async () => {
    await designApi.deleteDesign(entry.design.designId, entry.design.revision);
    await loadEntries();
    return `已删除「${entry.design.designName}」`;
  });

  const exportEntry = (entry: GalleryEntry) => runEntryAction(entry, () => exportDesignCard(entry));

  const renderCard = (entry: GalleryEntry, isFeatured: boolean) => {
    const { design } = entry;
    const statusLabel = statusLabelFor(entry.status);
    const isDraft = statusLabel === "草稿";
    const busy = busyDesignId === design.designId;
    const deleteArmed = deleteArmedId === design.designId;
    const wristCm = (design.bracelet.wristCircumferenceMm / 10).toFixed(1);

    const overlayActions = (
      <div
        className={`absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-[#241b2e]/85 px-3 py-2.5 text-xs text-white backdrop-blur-sm ${isFeatured ? "" : "translate-y-full opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100"}`}
        data-gallery-overlay={design.designId}
      >
        <Link className="flex min-h-9 items-center gap-1 rounded-full px-3 transition hover:bg-white/15" data-gallery-action="edit" href={editorRouteFor(design)}>
          <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" viewBox="0 0 24 24" width="13"><path d="M14.5 5.5 18.5 9.5 8.5 19.5H4.5v-4Z" /></svg>
          继续编辑
        </Link>
        <Link className="flex min-h-9 items-center gap-1 rounded-full px-3 transition hover:bg-white/15" data-gallery-action="detail" href={detailRouteFor(design)}>
          <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="13"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.01" strokeLinecap="round" /></svg>
          查看详情
        </Link>
        <button className="flex min-h-9 items-center gap-1 rounded-full px-3 transition hover:bg-white/15 disabled:opacity-55" data-gallery-action="export" disabled={busy} onClick={() => void exportEntry(entry)} type="button">
          <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" viewBox="0 0 24 24" width="13"><path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19h14" /></svg>
          导出设计图
        </button>
        <button className="flex min-h-9 items-center gap-1 rounded-full px-3 transition hover:bg-white/15 disabled:opacity-55" data-gallery-action="clone" disabled={busy} onClick={() => void cloneEntry(entry)} type="button">
          <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="13"><rect height="12" rx="2" width="12" x="8" y="8" /><path d="M16 5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2" /></svg>
          复制方案
        </button>
        {!isFeatured ? (
          <button
            className={`flex min-h-9 items-center gap-1 rounded-full px-3 transition disabled:opacity-55 ${deleteArmed ? "bg-[var(--danger)] text-white" : "hover:bg-white/15"}`}
            data-gallery-action={deleteArmed ? "delete-confirm" : "delete"}
            disabled={busy}
            onClick={() => (deleteArmed ? void deleteEntry(entry) : setDeleteArmedId(design.designId))}
            type="button"
          >
            <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" viewBox="0 0 24 24" width="13"><path d="M4 6.5h16M9 6.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5M6.5 6.5 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5" /></svg>
            {deleteArmed ? "确认删除" : "删除"}
          </button>
        ) : null}
      </div>
    );

    return (
      <article
        className={`group relative flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white transition hover:border-[var(--accent)]/60 hover:shadow-[0_10px_28px_rgb(57_45_67/0.08)] ${isFeatured ? "sm:col-span-2" : ""}`}
        data-gallery-card={design.designId}
        key={design.designId}
      >
        <div className={`relative grid place-items-center bg-[#f5f4f2] p-5 lg:p-6 ${isFeatured ? "min-h-[13rem] lg:min-h-[16rem]" : "min-h-[10rem]"}`}>
          {isFeatured ? (
            <span className="absolute left-4 top-4 rounded-full bg-[var(--accent-deep)] px-3 py-1 text-xs text-white">精选</span>
          ) : null}
          <BeadStrip
            beadClass={isFeatured ? "h-14 w-14 lg:h-16 lg:w-16" : "h-11 w-11 lg:h-13 lg:w-13"}
            beads={sortedBeads(design)}
            limit={isFeatured ? FEATURED_BEAD_LIMIT : CARD_BEAD_LIMIT}
            total={design.beads.length}
          />
          <div className="hidden lg:block">{overlayActions}</div>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-medium">
                <Link className="hover:text-[var(--accent)]" href={detailRouteFor(design)}>{design.designName}</Link>
              </h3>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{gallerySourceLabel(design)} · {statusLabel}</p>
            </div>
            <span
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[0.68rem] ${isDraft ? "border-amber-500/40 text-amber-700" : "border-[var(--accent)]/35 text-[var(--accent-deep)]"}`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="text-xs leading-5 text-[var(--muted)]">
            手围 {wristCm} cm · 材料总价 {formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })} · 更新时间 {formatGalleryUpdatedAt(entry.updatedAt)}
          </p>
          <div className="mt-auto flex items-center gap-2 pt-2 lg:hidden">
            <Link
              className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[var(--accent-deep)] text-sm text-white"
              data-gallery-action="edit"
              href={editorRouteFor(design)}
            >
              继续编辑
            </Link>
            <button
              aria-expanded={menuOpenId === design.designId}
              aria-label={`更多操作：${design.designName}`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--border)] text-[var(--muted)]"
              data-gallery-action="menu"
              onClick={() => setMenuOpenId((current) => (current === design.designId ? null : design.designId))}
              type="button"
            >
              <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 24 24" width="16"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
            </button>
            {menuOpenId === design.designId ? (
              <>
                <button aria-label="关闭菜单" className="fixed inset-0 z-20 cursor-default" onClick={() => setMenuOpenId(null)} type="button" />
                <div className="absolute bottom-16 right-3 z-30 w-40 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-[0_12px_32px_rgb(36_27_46/0.16)]" data-gallery-menu={design.designId}>
                  <button className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm hover:bg-[var(--surface-soft)] disabled:opacity-55" data-gallery-action="export" disabled={busy} onClick={() => void exportEntry(entry)} type="button">
                    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" viewBox="0 0 24 24" width="14"><path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19h14" /></svg>
                    导出设计图
                  </button>
                  <button className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm hover:bg-[var(--surface-soft)] disabled:opacity-55" data-gallery-action="clone" disabled={busy} onClick={() => void cloneEntry(entry)} type="button">
                    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="14"><rect height="12" rx="2" width="12" x="8" y="8" /><path d="M16 5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2" /></svg>
                    复制方案
                  </button>
                  <button
                    className={`flex w-full items-center gap-2 border-t border-[var(--border)] px-3.5 py-3 text-left text-sm hover:bg-[#f8edef] disabled:opacity-55 ${deleteArmed ? "font-medium text-[var(--danger)]" : "text-[var(--danger)]"}`}
                    data-gallery-action={deleteArmed ? "delete-confirm" : "delete"}
                    disabled={busy}
                    onClick={() => (deleteArmed ? void deleteEntry(entry) : setDeleteArmedId(design.designId))}
                    type="button"
                  >
                    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" viewBox="0 0 24 24" width="14"><path d="M4 6.5h16M9 6.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5M6.5 6.5 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5" /></svg>
                    {deleteArmed ? "确认删除" : "删除"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </article>
    );
  };

  if (isLoading) {
    return (
      <main className="mx-auto grid min-h-[60vh] max-w-7xl place-items-center px-5 py-16" aria-live="polite" data-gallery-page="loading">
        <p className="text-sm text-[var(--muted)]">正在从 Backend 加载我的设计…</p>
      </main>
    );
  }

  if (notice && entries.length === 0) {
    return (
      <main className="mx-auto min-h-[60vh] max-w-3xl px-5 py-16" data-gallery-page="error">
        <FlowNotice code={notice} onAction={() => { setNotice(null); setIsLoading(true); void loadEntries().finally(() => setIsLoading(false)); }} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--surface)] pb-24 lg:pb-16" data-gallery-page="ready">
      <div className="mx-auto max-w-[92.5rem] px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        <header className="lg:hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-serif text-2xl">我的作品</h1>
              <p className="mt-1 text-xs text-[var(--muted)]" aria-live="polite">{stats.total} 个设计 · {stats.drafts} 个草稿</p>
            </div>
            <Link className="flex min-h-11 shrink-0 items-center rounded-xl bg-[var(--accent-deep)] px-5 text-sm text-white" data-gallery-action="create" href="/diy">新建</Link>
          </div>
        </header>

        <div className="hidden items-end justify-between gap-6 lg:flex">
          <div>
            <h1 className="font-serif text-3xl">作品画廊 <span className="text-base tracking-[0.12em] text-[var(--muted)]">Gallery</span></h1>
            <p className="mt-1.5 text-sm text-[var(--muted)]">保存灵感，也继续未完成的设计。</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="sr-only" htmlFor="gallery-search-desktop">搜索设计名或灵感</label>
            <div className="relative">
              <svg aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" fill="none" height="16" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="16">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16.5 16.5 4 4" strokeLinecap="round" />
              </svg>
              <input
                className="min-h-11 w-72 rounded-full border border-[var(--border)] bg-white pl-10 pr-4 text-sm outline-none transition focus:border-[var(--accent)]"
                id="gallery-search-desktop"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索设计名或灵感"
                type="search"
                value={query}
              />
            </div>
            <Link className="flex min-h-11 items-center rounded-full bg-[var(--accent-deep)] px-6 text-sm text-white shadow-[0_12px_30px_rgb(73_53_95/0.24)] transition hover:bg-[var(--accent)]" data-gallery-action="create" href="/diy">新建设计</Link>
          </div>
        </div>

        <div className="mt-4 lg:mt-6">
          <label className="sr-only" htmlFor="gallery-search-mobile">搜索设计名或灵感</label>
          <div className="relative lg:hidden">
            <svg aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" fill="none" height="16" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="16">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16.5 16.5 4 4" strokeLinecap="round" />
            </svg>
            <input
              className="min-h-11 w-full rounded-full border border-[var(--border)] bg-white pl-10 pr-4 text-sm outline-none transition focus:border-[var(--accent)]"
              id="gallery-search-mobile"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索设计名或灵感"
              type="search"
              value={query}
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0 lg:pb-0" data-gallery-filters="true">
              {GALLERY_FILTER_OPTIONS.map((option) => {
                const active = filterId === option.id;
                return (
                  <button
                    aria-pressed={active}
                    className={`min-h-9 shrink-0 rounded-full border px-4 text-xs transition lg:text-sm ${active ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white" : "border-[var(--border)] bg-white text-[var(--muted)] hover:border-[var(--accent)]"}`}
                    data-gallery-filter={option.id}
                    key={option.id}
                    onClick={() => setFilterId(option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="hidden shrink-0 text-sm text-[var(--muted)] lg:block" aria-live="polite">{stats.total} 个设计 · {stats.drafts} 个草稿 · {stats.completed} 个完成</p>
          </div>
        </div>

        {notice ? <div className="mt-4"><FlowNotice code={notice} compact onAction={() => setNotice(null)} /></div> : null}
        {message ? (
          <p className="mt-4 rounded-full bg-[var(--accent-soft)] px-5 py-2 text-sm text-[var(--success)]" data-gallery-toast="true" role="status">{message}</p>
        ) : null}

        {filtered.length === 0 ? (
          entries.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-[var(--border)] bg-white p-10 text-center" data-gallery-empty="true">
              <p className="font-serif text-xl">还没有作品</p>
              <p className="mt-2 text-sm text-[var(--muted)]">从 AI 设计、塔罗引导或 DIY 创作开始，保存后的设计都会出现在这里。</p>
              <Link className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--accent-deep)] px-6 text-sm text-white" href="/diy">去创作第一件作品</Link>
            </div>
          ) : (
            <p className="mt-8 rounded-2xl bg-[var(--surface-soft)] p-6 text-center text-sm text-[var(--muted)]" data-gallery-empty="filtered">没有符合条件的作品，请调整筛选。</p>
          )
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4" data-gallery-grid="true">
            {featured ? renderCard(featured, true) : null}
            {rest.map((entry) => renderCard(entry, false))}
          </div>
        )}
      </div>
    </main>
  );
}
