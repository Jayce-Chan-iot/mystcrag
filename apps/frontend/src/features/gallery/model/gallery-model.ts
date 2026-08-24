import type { DesignPersistenceStatus, PublicDesignV1 } from "@mystcrag/design-contract";

export type GalleryEntry = {
  design: PublicDesignV1;
  status: DesignPersistenceStatus;
  updatedAt: string;
};

export type GalleryFilterId = "ALL" | "DRAFT" | "COMPLETED" | "AI_DESIGN" | "TAROT_INSPIRED" | "DIY";

export type GalleryStats = {
  total: number;
  drafts: number;
  completed: number;
};

export const GALLERY_FILTER_OPTIONS: ReadonlyArray<{ id: GalleryFilterId; label: string }> = [
  { id: "ALL", label: "全部" },
  { id: "DRAFT", label: "草稿" },
  { id: "COMPLETED", label: "已完成" },
  { id: "AI_DESIGN", label: "AI 设计" },
  { id: "TAROT_INSPIRED", label: "塔罗灵感" },
  { id: "DIY", label: "DIY" }
];

const DRAFT_STATUSES: ReadonlySet<DesignPersistenceStatus> = new Set(["DRAFT", "GENERATED"]);
const COMPLETED_STATUSES: ReadonlySet<DesignPersistenceStatus> = new Set(["SAVED", "ARCHIVED"]);
const AI_DESIGN_MODES: ReadonlySet<PublicDesignV1["designMode"]> = new Set(["AI_GENERATED", "AI_ASSISTED"]);
const DIY_DESIGN_MODES: ReadonlySet<PublicDesignV1["designMode"]> = new Set(["DIY_CREATED", "TEMPLATE_REMIX"]);

export function statusLabelFor(status: DesignPersistenceStatus): string {
  return DRAFT_STATUSES.has(status) ? "草稿" : "已完成";
}

export function gallerySourceLabel(design: PublicDesignV1): string {
  if (AI_DESIGN_MODES.has(design.designMode)) return "AI 设计";
  if (design.designMode === "TAROT_GUIDED") return "塔罗灵感";
  return "DIY";
}

export function filterGalleryEntries(
  entries: ReadonlyArray<GalleryEntry>,
  filterId: GalleryFilterId,
  query: string
): GalleryEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    const { design, status } = entry;
    if (filterId === "DRAFT" && !DRAFT_STATUSES.has(status)) return false;
    if (filterId === "COMPLETED" && !COMPLETED_STATUSES.has(status)) return false;
    if (filterId === "AI_DESIGN" && !AI_DESIGN_MODES.has(design.designMode)) return false;
    if (filterId === "TAROT_INSPIRED" && design.designMode !== "TAROT_GUIDED") return false;
    if (filterId === "DIY" && !DIY_DESIGN_MODES.has(design.designMode)) return false;
    if (needle) {
      const haystack = `${design.designName} ${design.story.designStory}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function galleryStats(entries: ReadonlyArray<GalleryEntry>): GalleryStats {
  let drafts = 0;
  let completed = 0;
  for (const { status } of entries) {
    if (DRAFT_STATUSES.has(status)) drafts += 1;
    else if (COMPLETED_STATUSES.has(status)) completed += 1;
  }
  return { total: entries.length, drafts, completed };
}

export function detailRouteFor(design: PublicDesignV1): string {
  const designId = encodeURIComponent(design.designId);
  return AI_DESIGN_MODES.has(design.designMode) ? `/design/${designId}` : `/diy/${designId}`;
}

export function editorRouteFor(design: PublicDesignV1): string {
  return `/diy/${encodeURIComponent(design.designId)}`;
}

export function formatGalleryUpdatedAt(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
