import type { CatalogMaterialProduct, ListMyOrdersResponse, OrderSummaryStatus } from "@mystcrag/design-contract";

export type ProfileOrder = ListMyOrdersResponse["orders"][number];

export type OrderStatusTone = "amber" | "blue" | "green" | "gray" | "red";

export const ORDER_STATUS_PRESENTATION: Readonly<Record<OrderSummaryStatus, { label: string; tone: OrderStatusTone }>> = {
  PENDING: { label: "待确认", tone: "amber" },
  AWAITING_RESTOCK: { label: "待补货", tone: "amber" },
  CONFIRMED: { label: "已确认", tone: "blue" },
  IN_PRODUCTION: { label: "制作中", tone: "blue" },
  SHIPPED: { label: "已发货", tone: "green" },
  COMPLETED: { label: "已完成", tone: "gray" },
  CANCELLED: { label: "已取消", tone: "red" }
};

const ONGOING_ORDER_STATUSES: ReadonlySet<OrderSummaryStatus> = new Set([
  "PENDING",
  "AWAITING_RESTOCK",
  "CONFIRMED",
  "IN_PRODUCTION",
  "SHIPPED"
]);

export function ongoingOrderCount(orders: ReadonlyArray<ProfileOrder>): number {
  return orders.filter((order) => ONGOING_ORDER_STATUSES.has(order.status)).length;
}

export function restockEtaDays(order: ProfileOrder): number | null {
  if (order.fulfillment.status !== "AWAITING_RESTOCK") return null;
  return order.fulfillment.estimatedRestockDays > 0 ? order.fulfillment.estimatedRestockDays : null;
}

export type ProfileLevel = { level: number; title: string };

const LEVELS: ReadonlyArray<ProfileLevel & { minDesigns: number }> = [
  { minDesigns: 0, level: 1, title: "初识水晶" },
  { minDesigns: 3, level: 2, title: "灵感学徒" },
  { minDesigns: 10, level: 3, title: "晶曜匠人" },
  { minDesigns: 25, level: 4, title: "星辉设计师" },
  { minDesigns: 60, level: 5, title: "玄机大师" }
];

export function levelForDesignCount(designCount: number): ProfileLevel {
  let current = LEVELS[0]!;
  for (const candidate of LEVELS) {
    if (designCount >= candidate.minDesigns) current = candidate;
  }
  return { level: current.level, title: current.title };
}

function maskLocalEmail(value: string): string {
  const atIndex = value.indexOf("@");
  if (atIndex <= 0) return `${value.slice(0, 2)}****`;
  const local = value.slice(0, atIndex);
  const domain = value.slice(atIndex);
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}****${domain}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return `${value.slice(0, 3)}****`;
  return `${digits.slice(0, 3)}****${digits.slice(-2)}`;
}

export function maskContact(kind: "email" | "phone", value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return kind === "email" ? maskLocalEmail(trimmed) : maskPhone(trimmed);
}

export type ProfilePreferences = {
  wristCircumferenceMm: number;
  preferredDiameterMm: number;
  colorTags: string[];
};

export const PREFERRED_DIAMETERS: ReadonlyArray<number> = [6, 8, 10, 12];

export function resolvePreferences(stored: unknown, fallbackWristMm: number | null): ProfilePreferences {
  const defaults: ProfilePreferences = {
    wristCircumferenceMm: fallbackWristMm ?? 155,
    preferredDiameterMm: 8,
    colorTags: []
  };
  if (typeof stored !== "object" || stored === null) return defaults;
  const record = stored as Record<string, unknown>;
  const resolved: ProfilePreferences = { ...defaults };
  if (typeof record.wristCircumferenceMm === "number" && Number.isFinite(record.wristCircumferenceMm) && record.wristCircumferenceMm >= 120 && record.wristCircumferenceMm <= 220) {
    resolved.wristCircumferenceMm = Math.round(record.wristCircumferenceMm);
  }
  if (typeof record.preferredDiameterMm === "number" && PREFERRED_DIAMETERS.includes(record.preferredDiameterMm)) {
    resolved.preferredDiameterMm = record.preferredDiameterMm;
  }
  if (Array.isArray(record.colorTags)) {
    resolved.colorTags = record.colorTags.filter((tag): tag is string => typeof tag === "string");
  }
  return resolved;
}

export function favoriteMaterials(
  favoriteProductIds: ReadonlyArray<string>,
  materials: ReadonlyArray<CatalogMaterialProduct>
): CatalogMaterialProduct[] {
  const wanted = new Set(favoriteProductIds);
  return materials.filter((material) => wanted.has(material.beadProductId));
}

export function formatProfileDateTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function wristCentimeters(wristCircumferenceMm: number): string {
  return (wristCircumferenceMm / 10).toFixed(1);
}
