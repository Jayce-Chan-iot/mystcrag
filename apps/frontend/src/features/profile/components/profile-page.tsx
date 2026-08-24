"use client";

import type { CatalogMaterialProduct, PublicDesignV1 } from "@mystcrag/design-contract";
import Link from "next/link";
import * as React from "react";

import { FlowNotice } from "../../../components/flow-notice";
import { designApi } from "../../../lib/api/design-api";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import { CrystalBeadImage } from "../../design/components/crystal-bead-image";
import { formatMinorAmount } from "../../design/model/format-minor-amount";
import { COLOR_SWATCHES, COLOR_TAG_LABELS } from "../../library/model/library-model";
import {
  detailRouteFor,
  editorRouteFor,
  formatGalleryUpdatedAt,
  gallerySourceLabel,
  statusLabelFor,
  type GalleryEntry
} from "../../gallery/model/gallery-model";
import {
  favoriteMaterials,
  formatProfileDateTime,
  levelForDesignCount,
  maskContact,
  ongoingOrderCount,
  ORDER_STATUS_PRESENTATION,
  PREFERRED_DIAMETERS,
  resolvePreferences,
  restockEtaDays,
  wristCentimeters,
  type ProfileOrder,
  type ProfilePreferences
} from "../model/profile-model";

const IDENTITY_STORAGE_KEY = "mystcrag:profile-identity";
const PREFERENCES_STORAGE_KEY = "mystcrag:profile-preferences";
const ADDRESS_BOOK_STORAGE_KEY = "mystcrag:address-book";
const FEEDBACK_LOG_STORAGE_KEY = "mystcrag:feedback-log";
const FAVORITES_STORAGE_KEY = "mystcrag:library-favorites";
const PRIVACY_STORAGE_KEY = "mystcrag:privacy-prefs";

const TONE_CLASSES: Record<string, string> = {
  amber: "text-amber-700",
  blue: "text-[#5b8db8]",
  green: "text-[#5f9c7a]",
  gray: "text-[var(--muted)]",
  red: "text-[var(--danger)]"
};

type ProfileTab = "overview" | "designs" | "orders" | "favorites" | "addresses" | "settings";

type ProfileIdentity = { name: string; email: string; phone: string };

type AddressEntry = {
  id: string;
  name: string;
  phone: string;
  region: string;
  detail: string;
  isDefault: boolean;
};

const SIDEBAR_ITEMS: ReadonlyArray<{ id: ProfileTab; label: string }> = [
  { id: "overview", label: "账户概览" },
  { id: "designs", label: "我的设计" },
  { id: "orders", label: "我的订单" },
  { id: "favorites", label: "我的收藏" },
  { id: "addresses", label: "地址管理" },
  { id: "settings", label: "设置与帮助" }
];

const SERVICE_ITEMS: ReadonlyArray<{ id: ProfileTab; label: string }> = [
  { id: "designs", label: "我的设计" },
  { id: "orders", label: "我的订单" },
  { id: "favorites", label: "我的收藏" },
  { id: "addresses", label: "地址管理" },
  { id: "settings", label: "帮助与反馈" },
  { id: "settings", label: "隐私设置" }
];

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function sortedBeads(design: PublicDesignV1) {
  return [...design.beads].sort((left, right) => left.positionIndex - right.positionIndex);
}

function BeadThumbnails({ design, limit, beadClass }: { design: PublicDesignV1; limit: number; beadClass: string }) {
  const beads = sortedBeads(design).slice(0, limit);
  return (
    <div className="flex items-center gap-1">
      {beads.map((bead) => (
        <span className={`block shrink-0 ${beadClass}`} key={bead.componentId}>
          <CrystalBeadImage alt="" materialKey={bead.materialKey} sizes="64px" />
        </span>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: ProfileOrder["status"] }) {
  const presentation = ORDER_STATUS_PRESENTATION[status];
  return <span className={`text-xs font-medium ${TONE_CLASSES[presentation.tone]}`}>{presentation.label}</span>;
}

function OrderRow({ order, onOpen }: { order: ProfileOrder; onOpen: () => void }) {
  const eta = restockEtaDays(order);
  return (
    <button
      className="flex w-full items-center gap-3 border-b border-[var(--border)] px-1 py-3 text-left transition last:border-b-0 hover:bg-[var(--surface-soft)]"
      data-profile-order={order.orderId}
      onClick={onOpen}
      type="button"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#f5f4f2]">
        <BeadThumbnails beadClass="h-4 w-4" design={order.design} limit={3} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{order.design.designName}</span>
        <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
          订单号 {order.orderId} · 下单时间 {formatProfileDateTime(order.createdAt)}
        </span>
        <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
          合计 {formatMinorAmount({ amountMinor: order.totalAmountMinor, currency: order.currency, locale: order.design.locale })}
          {eta !== null ? ` · 预计 ${eta} 天` : ""}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge status={order.status} />
        <svg aria-hidden="true" className="text-[var(--muted)]" fill="none" height="14" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="14"><path d="m9 6 6 6-6 6" strokeLinecap="round" /></svg>
      </span>
    </button>
  );
}

export function ProfilePage() {
  const [designs, setDesigns] = React.useState<GalleryEntry[]>([]);
  const [orders, setOrders] = React.useState<ProfileOrder[]>([]);
  const [materials, setMaterials] = React.useState<CatalogMaterialProduct[]>([]);
  const [favoriteIds, setFavoriteIds] = React.useState<string[]>([]);
  const [identity, setIdentity] = React.useState<ProfileIdentity>({ name: "小玄机", email: "", phone: "" });
  const [preferences, setPreferences] = React.useState<ProfilePreferences>(() => resolvePreferences(null, null));
  const [addresses, setAddresses] = React.useState<AddressEntry[]>([]);
  const [feedbackCount, setFeedbackCount] = React.useState(0);
  const [privacyAnonymous, setPrivacyAnonymous] = React.useState(true);
  const [isLoading, setIsLoading] = React.useState(true);
  const [notice, setNotice] = React.useState<FrontendErrorCode | null>(null);
  const [message, setMessage] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<ProfileTab>("overview");
  const [identityDraft, setIdentityDraft] = React.useState<ProfileIdentity | null>(null);
  const [prefDraft, setPrefDraft] = React.useState<ProfilePreferences | null>(null);
  const [addressDraft, setAddressDraft] = React.useState<Partial<AddressEntry> | null>(null);
  const [feedbackText, setFeedbackText] = React.useState("");

  const loadRemote = React.useCallback(() => {
    return Promise.all([
      designApi.listDesigns(),
      designApi.listOrders(),
      designApi.materials("CNY")
    ]).then(([designsResponse, ordersResponse, catalogResponse]) => {
      setDesigns([...designsResponse.designs].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)));
      setOrders(ordersResponse.orders);
      setMaterials(catalogResponse.materials);
      setNotice(null);
    }).catch((error: unknown) => {
      setNotice(toFrontendApiError(error).code);
    });
  }, []);

  React.useEffect(() => {
    let active = true;
    void Promise.all([
      designApi.listDesigns(),
      designApi.listOrders(),
      designApi.materials("CNY")
    ]).then(([designsResponse, ordersResponse, catalogResponse]) => {
      if (!active) return;
      const sorted = [...designsResponse.designs].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      setDesigns(sorted);
      setOrders(ordersResponse.orders);
      setMaterials(catalogResponse.materials);
      setNotice(null);
      setIdentity(readJson<ProfileIdentity>(IDENTITY_STORAGE_KEY, { name: "小玄机", email: "", phone: "" }));
      setFavoriteIds(readJson<string[]>(FAVORITES_STORAGE_KEY, []));
      setAddresses(readJson<AddressEntry[]>(ADDRESS_BOOK_STORAGE_KEY, []));
      setFeedbackCount(readJson<string[]>(FEEDBACK_LOG_STORAGE_KEY, []).length);
      setPrivacyAnonymous(
        readJson<{ creatorDisplayMode: string }>(PRIVACY_STORAGE_KEY, { creatorDisplayMode: "ANONYMOUS" }).creatorDisplayMode === "ANONYMOUS"
      );
      setPreferences(
        resolvePreferences(readJson<unknown>(PREFERENCES_STORAGE_KEY, null), sorted[0]?.design.bracelet.wristCircumferenceMm ?? null)
      );
    }).catch((error: unknown) => {
      if (active) setNotice(toFrontendApiError(error).code);
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

  const sortedDesigns = React.useMemo(
    () => [...designs].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
    [designs]
  );
  const favorites = React.useMemo(() => favoriteMaterials(favoriteIds, materials), [favoriteIds, materials]);
  const level = levelForDesignCount(designs.length);
  const ongoing = ongoingOrderCount(orders);
  const continueDesigns = sortedDesigns.slice(0, 3);
  const locale = designs[0]?.design.locale ?? "zh-CN";

  const saveIdentity = (next: ProfileIdentity) => {
    setIdentity(next);
    writeJson(IDENTITY_STORAGE_KEY, next);
    setIdentityDraft(null);
    setMessage("资料已更新。");
  };

  const savePreferences = (next: ProfilePreferences) => {
    setPreferences(next);
    writeJson(PREFERENCES_STORAGE_KEY, next);
    setPrefDraft(null);
    setMessage("偏好已保存。");
  };

  const persistAddresses = (next: AddressEntry[]) => {
    setAddresses(next);
    writeJson(ADDRESS_BOOK_STORAGE_KEY, next);
  };

  const submitAddress = () => {
    const draft = addressDraft ?? {};
    if (!draft.name?.trim() || !draft.phone?.trim() || !draft.region?.trim() || !draft.detail?.trim()) {
      setMessage("请完整填写收件人、电话、地区与详细地址。");
      return;
    }
    const entry: AddressEntry = {
      id: draft.id ?? `addr-${crypto.randomUUID()}`,
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      region: draft.region.trim(),
      detail: draft.detail.trim(),
      isDefault: draft.isDefault ?? addresses.length === 0
    };
    const next = draft.id ? addresses.map((item) => (item.id === draft.id ? entry : item)) : [...addresses, entry];
    const normalized = entry.isDefault
      ? next.map((item) => (item.id === entry.id ? item : { ...item, isDefault: false }))
      : next;
    persistAddresses(normalized);
    setAddressDraft(null);
    setMessage(draft.id ? "地址已更新。" : "地址已添加。");
  };

  const setDefaultAddress = (id: string) => {
    persistAddresses(addresses.map((item) => ({ ...item, isDefault: item.id === id })));
    setMessage("默认地址已切换。");
  };

  const removeAddress = (id: string) => {
    const next = addresses.filter((item) => item.id !== id);
    if (next.length > 0 && !next.some((item) => item.isDefault)) next[0] = { ...next[0]!, isDefault: true };
    persistAddresses(next);
    setMessage("地址已删除。");
  };

  const submitFeedback = () => {
    const trimmed = feedbackText.trim();
    if (!trimmed) {
      setMessage("请先写下你的建议或问题。");
      return;
    }
    const log = readJson<string[]>(FEEDBACK_LOG_STORAGE_KEY, []);
    log.push(trimmed);
    writeJson(FEEDBACK_LOG_STORAGE_KEY, log);
    setFeedbackCount(log.length);
    setFeedbackText("");
    setMessage("反馈已记录，感谢你的建议。");
  };

  const togglePrivacy = (anonymous: boolean) => {
    setPrivacyAnonymous(anonymous);
    writeJson(PRIVACY_STORAGE_KEY, { creatorDisplayMode: anonymous ? "ANONYMOUS" : "DISPLAY_NAME" });
    setMessage(anonymous ? "新作品将默认匿名展示。" : "新作品将默认署名展示。");
  };

  const renderStats = () => (
    <div className="grid grid-cols-4 divide-x divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-white py-4">
      <div className="flex flex-col items-center gap-0.5 px-1" data-profile-stat="designs">
        <span className="font-serif text-2xl">{designs.length}</span>
        <span className="text-[0.68rem] text-[var(--muted)]">设计</span>
      </div>
      <div className="flex flex-col items-center gap-0.5 px-1" data-profile-stat="favorites">
        <span className="font-serif text-2xl">{favorites.length}</span>
        <span className="text-[0.68rem] text-[var(--muted)]">收藏</span>
      </div>
      <div className="flex flex-col items-center gap-0.5 px-1" data-profile-stat="orders">
        <span className="font-serif text-2xl">{ongoing}</span>
        <span className="text-[0.68rem] text-[var(--muted)]"><span className="hidden lg:inline">进行中</span>订单</span>
      </div>
      <div className="flex flex-col items-center gap-0.5 px-1" data-profile-stat="wrist">
        <span className="font-serif text-2xl">{wristCentimeters(preferences.wristCircumferenceMm)}</span>
        <span className="text-[0.68rem] text-[var(--muted)]">默认手围 cm</span>
      </div>
    </div>
  );

  const renderContinueCard = (entry: GalleryEntry) => (
    <article className="flex w-56 shrink-0 flex-col gap-2 rounded-2xl border border-[var(--border)] bg-white p-3 sm:w-auto" data-profile-continue={entry.design.designId} key={entry.design.designId}>
      <div className="grid aspect-[5/3] place-items-center rounded-xl bg-[#f5f4f2] p-3">
        <BeadThumbnails beadClass="h-9 w-9" design={entry.design} limit={5} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-medium">{entry.design.designName}</h3>
        <span className="shrink-0 text-[0.68rem] text-[var(--muted)]">{statusLabelFor(entry.status)}</span>
      </div>
      <p className="text-xs text-[var(--muted)]">更新于 {formatGalleryUpdatedAt(entry.updatedAt)}</p>
      <Link className="mt-auto inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--border)] text-xs text-[var(--accent-deep)] transition hover:border-[var(--accent)]" data-profile-action="continue" href={editorRouteFor(entry.design)}>
        继续编辑 →
      </Link>
    </article>
  );

  const renderPreferencesCard = () => (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4" data-profile-section="preferences">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">我的偏好</h2>
        <button className="flex items-center gap-1 text-xs text-[var(--muted)] transition hover:text-[var(--accent)]" data-profile-action="pref-edit" onClick={() => setPrefDraft(preferences)} type="button">
          <svg aria-hidden="true" fill="none" height="12" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="12"><path d="M14.5 5.5 18.5 9.5 8.5 19.5H4.5v-4Z" /></svg>
          编辑
        </button>
      </div>
      <dl className="mt-3 space-y-2.5 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-[var(--muted)]">默认手围</dt>
          <dd className="font-medium">{wristCentimeters(preferences.wristCircumferenceMm)} cm</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--muted)]">常用尺寸</dt>
          <dd className="font-medium">{preferences.preferredDiameterMm} mm</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--muted)]">喜爱色系</dt>
          <dd className="flex items-center gap-1.5">
            {preferences.colorTags.length === 0 ? <span className="text-xs text-[var(--muted)]">未设置</span> : preferences.colorTags.slice(0, 5).map((tag) => (
              <span className="flex items-center gap-1" key={tag}>
                <span className="h-4 w-4 rounded-full border border-black/8" style={{ background: COLOR_SWATCHES[tag] ?? "#ddd" }} />
                <span className="text-xs">{COLOR_TAG_LABELS[tag] ?? tag}</span>
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </div>
  );

  const renderFavoriteStones = () => (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4" data-profile-section="favorite-stones">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">收藏的矿石</h2>
        <button className="text-xs text-[var(--muted)] transition hover:text-[var(--accent)]" data-profile-action="favorites-tab" onClick={() => setActiveTab("favorites")} type="button">
          {favorites.length > 0 ? `共 ${favorites.length} 颗 →` : "去收藏 →"}
        </button>
      </div>
      {favorites.length === 0 ? (
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">还没有收藏的矿石，<Link className="text-[var(--accent)]" href="/crystal-library">去矿石库</Link>点击爱心即可收藏。</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {favorites.slice(0, 8).map((material) => (
            <span className="block h-10 w-10" key={material.beadProductId} title={material.crystalNameCn}>
              <CrystalBeadImage alt="" materialKey={material.materialKey} sizes="40px" />
            </span>
          ))}
          {favorites.length > 8 ? <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--surface-soft)] text-xs text-[var(--muted)]">+{favorites.length - 8}</span> : null}
        </div>
      )}
    </div>
  );

  const renderOrdersList = (limit: number) => (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4" data-profile-section="orders">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">我的订单</h2>
        {limit < orders.length ? (
          <button className="text-xs text-[var(--muted)] transition hover:text-[var(--accent)]" data-profile-action="orders-tab" onClick={() => setActiveTab("orders")} type="button">
            查看全部订单 →
          </button>
        ) : null}
      </div>
      {orders.length === 0 ? (
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">还没有订单，完成设计后即可下单制作。</p>
      ) : (
        <div className="mt-1">{orders.slice(0, limit).map((order) => <OrderRow key={order.orderId} onOpen={() => setActiveTab("orders")} order={order} />)}</div>
      )}
    </div>
  );

  const renderOverview = () => (
    <div className="space-y-6" data-profile-tab-panel="overview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-2xl">欢迎回来，{identity.name}</h2>
        <Link className="flex min-h-11 items-center rounded-full bg-[var(--accent-deep)] px-6 text-sm text-white shadow-[0_12px_30px_rgb(73_53_95/0.24)] transition hover:bg-[var(--accent)]" data-profile-action="create" href="/diy">新建设计</Link>
      </div>
      {renderStats()}
      <section aria-labelledby="profile-continue-title">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium" id="profile-continue-title">继续你的设计</h2>
          <button className="text-xs text-[var(--muted)] transition hover:text-[var(--accent)]" data-profile-action="designs-tab" onClick={() => setActiveTab("designs")} type="button">查看全部 →</button>
        </div>
        {continueDesigns.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-[var(--surface-soft)] p-5 text-center text-sm text-[var(--muted)]">还没有设计，从<Link className="text-[var(--accent)]" href="/ai-design">AI 设计</Link>或<Link className="text-[var(--accent)]" href="/tarot/setup">塔罗引导</Link>开始吧。</p>
        ) : (
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible">{continueDesigns.map(renderContinueCard)}</div>
        )}
      </section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {renderOrdersList(3)}
        <div className="space-y-4">
          {renderPreferencesCard()}
          {renderFavoriteStones()}
        </div>
      </div>
    </div>
  );

  const renderDesignsTab = () => (
    <div className="space-y-4" data-profile-tab-panel="designs">
      <h2 className="font-serif text-2xl">我的设计 <span className="text-sm text-[var(--muted)]">共 {designs.length} 件</span></h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sortedDesigns.map((entry) => (
          <article className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-white p-3" data-profile-design={entry.design.designId} key={entry.design.designId}>
            <div className="grid aspect-square place-items-center rounded-xl bg-[#f5f4f2] p-3">
              <BeadThumbnails beadClass="h-8 w-8" design={entry.design} limit={4} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="min-w-0 truncate text-sm font-medium">{entry.design.designName}</h3>
              <span className="shrink-0 text-[0.68rem] text-[var(--muted)]">{statusLabelFor(entry.status)}</span>
            </div>
            <p className="text-xs text-[var(--muted)]">{gallerySourceLabel(entry.design)} · {formatGalleryUpdatedAt(entry.updatedAt)}</p>
            <Link className="mt-auto inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--border)] text-xs text-[var(--accent-deep)] transition hover:border-[var(--accent)]" href={detailRouteFor(entry.design)}>查看 →</Link>
          </article>
        ))}
      </div>
      {designs.length === 0 ? <p className="rounded-2xl bg-[var(--surface-soft)] p-5 text-center text-sm text-[var(--muted)]">还没有设计作品。</p> : null}
    </div>
  );

  const renderOrdersTab = () => (
    <div className="space-y-4" data-profile-tab-panel="orders">
      <h2 className="font-serif text-2xl">我的订单 <span className="text-sm text-[var(--muted)]">共 {orders.length} 单 · 进行中 {ongoing} 单</span></h2>
      {renderOrdersList(orders.length)}
    </div>
  );

  const renderFavoritesTab = () => (
    <div className="space-y-4" data-profile-tab-panel="favorites">
      <h2 className="font-serif text-2xl">我的收藏 <span className="text-sm text-[var(--muted)]">共 {favorites.length} 件</span></h2>
      {favorites.length === 0 ? (
        <p className="rounded-2xl bg-[var(--surface-soft)] p-5 text-center text-sm text-[var(--muted)]">还没有收藏，<Link className="text-[var(--accent)]" href="/crystal-library">去矿石库逛逛</Link>。</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {favorites.map((material) => (
            <article className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-white p-3" data-profile-favorite={material.beadProductId} key={material.beadProductId}>
              <div className="grid aspect-square place-items-center rounded-xl bg-[#f5f4f2] p-3">
                <span className="block h-[80%] w-[80%]"><CrystalBeadImage alt="" materialKey={material.materialKey} sizes="160px" /></span>
              </div>
              <h3 className="truncate text-sm font-medium">{material.crystalNameCn}</h3>
              <p className="text-xs text-[var(--muted)]">{material.diameterMm}mm · {formatMinorAmount({ amountMinor: material.unitPriceMinor, currency: material.currency, locale })}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );

  const renderAddressesTab = () => (
    <div className="space-y-4" data-profile-tab-panel="addresses">
      <h2 className="font-serif text-2xl">地址管理</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {addresses.map((address) => (
          <article className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-white p-4" data-profile-address={address.id} key={address.id}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{address.name} · {address.phone}</p>
              {address.isDefault ? <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[0.68rem] text-[var(--accent-deep)]">默认</span> : null}
            </div>
            <p className="text-xs leading-5 text-[var(--muted)]">{address.region} {address.detail}</p>
            <div className="mt-auto flex items-center gap-2 pt-1">
              <button className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--muted)] transition hover:border-[var(--accent)]" data-profile-action="address-edit" onClick={() => setAddressDraft(address)} type="button">编辑</button>
              {!address.isDefault ? (
                <button className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--muted)] transition hover:border-[var(--accent)]" data-profile-action="address-default" onClick={() => setDefaultAddress(address.id)} type="button">设为默认</button>
              ) : null}
              <button className="min-h-9 rounded-lg border border-[var(--danger)]/30 px-3 text-xs text-[var(--danger)] transition hover:bg-[#f8edef]" data-profile-action="address-delete" onClick={() => removeAddress(address.id)} type="button">删除</button>
            </div>
          </article>
        ))}
        <button className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-[var(--border)] bg-white text-sm text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]" data-profile-action="address-add" onClick={() => setAddressDraft({ name: "", phone: "", region: "", detail: "" })} type="button">
          <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="18"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
          新增地址
        </button>
      </div>
    </div>
  );

  const renderSettingsTab = () => (
    <div className="space-y-4" data-profile-tab-panel="settings">
      <h2 className="font-serif text-2xl">设置与帮助</h2>
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4" data-profile-section="privacy">
        <h3 className="text-sm font-medium">隐私设置</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">新作品发布到灵感广场时的默认署名方式。</p>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-white p-1">
          <button aria-pressed={privacyAnonymous} className={`min-h-9 rounded-lg text-xs transition ${privacyAnonymous ? "bg-[var(--accent-deep)] text-white" : "text-[var(--muted)]"}`} data-profile-privacy="ANONYMOUS" onClick={() => togglePrivacy(true)} type="button">匿名展示</button>
          <button aria-pressed={!privacyAnonymous} className={`min-h-9 rounded-lg text-xs transition ${!privacyAnonymous ? "bg-[var(--accent-deep)] text-white" : "text-[var(--muted)]"}`} data-profile-privacy="DISPLAY_NAME" onClick={() => togglePrivacy(false)} type="button">署名展示</button>
        </div>
      </section>
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4" data-profile-section="feedback">
        <h3 className="text-sm font-medium">帮助与反馈</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">写下使用中遇到的问题或建议（已收到 {feedbackCount} 条反馈）。</p>
        <textarea
          className="mt-3 min-h-24 w-full rounded-xl border border-[var(--border)] bg-white p-3 text-sm outline-none transition focus:border-[var(--accent)]"
          data-profile-feedback-input
          onChange={(event) => setFeedbackText(event.target.value)}
          placeholder="例如：希望矿石库支持按矿物筛选…"
          value={feedbackText}
        />
        <button className="mt-3 flex min-h-11 items-center rounded-xl bg-[var(--accent-deep)] px-6 text-sm text-white transition hover:bg-[var(--accent)]" data-profile-action="feedback-submit" onClick={submitFeedback} type="button">提交反馈</button>
      </section>
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4" data-profile-section="preferences-reset">
        <h3 className="text-sm font-medium">偏好设置</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">调整默认手围、常用珠径与喜爱色系，将同步用于设计默认值。</p>
        <button className="mt-3 flex min-h-11 items-center rounded-xl border border-[var(--border)] px-6 text-sm text-[var(--accent-deep)] transition hover:border-[var(--accent)]" data-profile-action="pref-edit" onClick={() => setPrefDraft(preferences)} type="button">编辑偏好</button>
      </section>
    </div>
  );

  if (isLoading) {
    return (
      <main className="mx-auto grid min-h-[60vh] max-w-7xl place-items-center px-5 py-16" aria-live="polite" data-profile-page="loading">
        <p className="text-sm text-[var(--muted)]">正在从 Backend 加载账户数据…</p>
      </main>
    );
  }

  if (notice && designs.length === 0 && orders.length === 0) {
    return (
      <main className="mx-auto min-h-[60vh] max-w-3xl px-5 py-16" data-profile-page="error">
        <FlowNotice code={notice} onAction={() => { setNotice(null); setIsLoading(true); void loadRemote().finally(() => setIsLoading(false)); }} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--surface)] pb-24 lg:pb-16" data-profile-page="ready">
      <div className="mx-auto max-w-[92.5rem] px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        <div className="flex items-center justify-between lg:hidden">
          <h1 className="font-serif text-2xl">我的</h1>
          <button aria-label="设置与帮助" className="grid h-10 w-10 place-items-center rounded-full border border-[var(--border)] bg-white text-[var(--muted)]" data-profile-action="settings-tab" onClick={() => setActiveTab("settings")} type="button">
            <svg aria-hidden="true" fill="none" height="17" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" width="17"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.31.6.92.99 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" /></svg>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-6 lg:mt-0 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-7">
          <aside>
            <div className="rounded-2xl border border-[var(--border)] bg-white p-4 lg:sticky lg:top-[4.5rem]" data-profile-sidebar="true">
              <div className="flex items-center gap-3 lg:flex-col lg:items-center lg:text-center">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#a88fc9] to-[var(--accent-deep)] font-serif text-xl text-white lg:h-20 lg:w-20 lg:text-3xl">
                  {identity.name.slice(0, 1)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium lg:mt-2 lg:text-base">{identity.name}</p>
                  <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[0.68rem] text-[var(--accent-deep)]">
                    <svg aria-hidden="true" fill="currentColor" height="10" viewBox="0 0 24 24" width="10"><path d="M12 2 14.4 9.6 22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4Z" /></svg>
                    Lv.{level.level} {level.title}
                  </p>
                </div>
              </div>
              <div className="mt-3 hidden space-y-1 text-xs text-[var(--muted)] lg:block">
                <p>{identity.email ? maskContact("email", identity.email) : "未设置邮箱"}</p>
                <p>{identity.phone ? maskContact("phone", identity.phone) : "未设置手机"}</p>
              </div>
              <button className="mt-3 flex min-h-10 w-full items-center justify-center rounded-xl border border-[var(--border)] text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]" data-profile-action="identity-edit" onClick={() => setIdentityDraft(identity)} type="button">
                编辑资料
              </button>
              <nav aria-label="个人中心导航" className="mt-4 hidden lg:block">
                <ul className="space-y-0.5">
                  {SIDEBAR_ITEMS.map((item) => {
                    const active = activeTab === item.id;
                    return (
                      <li key={`${item.id}-${item.label}`}>
                        <button
                          aria-current={active ? "page" : undefined}
                          className={`flex min-h-10 w-full items-center rounded-lg border-l-2 px-3 text-left text-sm transition ${active ? "border-[var(--accent-deep)] bg-[var(--accent-soft)] font-medium text-[var(--accent-deep)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--surface-soft)]"}`}
                          data-profile-tab={item.id}
                          onClick={() => setActiveTab(item.id)}
                          type="button"
                        >
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
          </aside>

          <section className="min-w-0">
            {notice ? <div className="mb-4"><FlowNotice code={notice} compact onAction={() => setNotice(null)} /></div> : null}
            {message ? <p className="mb-4 rounded-full bg-[var(--accent-soft)] px-5 py-2 text-sm text-[var(--success)]" data-profile-toast="true" role="status">{message}</p> : null}

            {activeTab === "overview" ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-[var(--border)] bg-white p-4 lg:hidden">
                  <div className="flex items-center gap-3">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#a88fc9] to-[var(--accent-deep)] font-serif text-xl text-white">{identity.name.slice(0, 1)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-base font-medium">{identity.name}</p>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[0.68rem] text-[var(--accent-deep)]">
                          <svg aria-hidden="true" fill="currentColor" height="9" viewBox="0 0 24 24" width="9"><path d="M12 2 14.4 9.6 22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4Z" /></svg>
                          Lv.{level.level} {level.title}
                        </span>
                      </div>
                      <button className="mt-1 text-xs text-[var(--muted)]" data-profile-action="identity-edit" onClick={() => setIdentityDraft(identity)} type="button">编辑资料 ›</button>
                    </div>
                  </div>
                </div>
                {renderOverview()}
                <section aria-labelledby="profile-services-title" className="lg:hidden">
                  <h2 className="text-sm font-medium" id="profile-services-title">常用服务</h2>
                  <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                    {SERVICE_ITEMS.map((item, index) => (
                      <button className="flex min-h-20 flex-col items-center justify-center gap-1.5 border-b border-r border-[var(--border)] p-2 text-xs text-[var(--muted)] transition hover:text-[var(--accent)] [&:nth-child(3n)]:border-r-0 [&:nth-child(n+4)]:border-b-0" data-profile-service={item.label} key={`${item.id}-${item.label}-${index}`} onClick={() => setActiveTab(item.id)} type="button">
                        {item.label}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}
            {activeTab === "designs" ? renderDesignsTab() : null}
            {activeTab === "orders" ? renderOrdersTab() : null}
            {activeTab === "favorites" ? renderFavoritesTab() : null}
            {activeTab === "addresses" ? renderAddressesTab() : null}
            {activeTab === "settings" ? renderSettingsTab() : null}
          </section>
        </div>
      </div>

      {identityDraft ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label="编辑资料">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-white p-5">
            <h2 className="text-base font-medium">编辑资料</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="text-xs text-[var(--muted)]">昵称</span>
                <input className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] px-3 outline-none focus:border-[var(--accent)]" data-profile-identity-input="name" onChange={(event) => setIdentityDraft({ ...identityDraft, name: event.target.value })} value={identityDraft.name} />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-[var(--muted)]">邮箱</span>
                <input className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] px-3 outline-none focus:border-[var(--accent)]" data-profile-identity-input="email" onChange={(event) => setIdentityDraft({ ...identityDraft, email: event.target.value })} placeholder="you@example.com" type="email" value={identityDraft.email} />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-[var(--muted)]">手机号</span>
                <input className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] px-3 outline-none focus:border-[var(--accent)]" data-profile-identity-input="phone" onChange={(event) => setIdentityDraft({ ...identityDraft, phone: event.target.value })} placeholder="138…（仅本地保存）" inputMode="tel" value={identityDraft.phone} />
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button className="min-h-11 flex-1 rounded-xl border border-[var(--border)] text-sm text-[var(--muted)]" data-profile-action="identity-cancel" onClick={() => setIdentityDraft(null)} type="button">取消</button>
              <button className="min-h-11 flex-1 rounded-xl bg-[var(--accent-deep)] text-sm text-white" data-profile-action="identity-save" onClick={() => saveIdentity(identityDraft)} type="button">保存</button>
            </div>
          </div>
        </div>
      ) : null}

      {prefDraft ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label="编辑偏好">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-white p-5">
            <h2 className="text-base font-medium">编辑偏好</h2>
            <div className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="text-xs text-[var(--muted)]">默认手围（{wristCentimeters(prefDraft.wristCircumferenceMm)} cm）</span>
                <input className="mt-1 w-full accent-[var(--accent-deep)]" data-profile-pref-input="wrist" max={220} min={120} onChange={(event) => setPrefDraft({ ...prefDraft, wristCircumferenceMm: Number(event.target.value) })} step={1} type="range" value={prefDraft.wristCircumferenceMm} />
              </label>
              <div className="text-sm">
                <span className="text-xs text-[var(--muted)]">常用珠径</span>
                <div className="mt-1.5 flex gap-1.5">
                  {PREFERRED_DIAMETERS.map((diameter) => (
                    <button aria-pressed={prefDraft.preferredDiameterMm === diameter} className={`min-h-9 flex-1 rounded-xl border text-xs transition ${prefDraft.preferredDiameterMm === diameter ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white" : "border-[var(--border)] text-[var(--muted)]"}`} data-profile-pref-diameter={diameter} key={diameter} onClick={() => setPrefDraft({ ...prefDraft, preferredDiameterMm: diameter })} type="button">
                      {diameter}mm
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-sm">
                <span className="text-xs text-[var(--muted)]">喜爱色系（可多选）</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(COLOR_TAG_LABELS).map(([tag, label]) => {
                    const active = prefDraft.colorTags.includes(tag);
                    return (
                      <button aria-pressed={active} className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs transition ${active ? "border-[var(--accent-deep)] text-[var(--accent-deep)]" : "border-[var(--border)] text-[var(--muted)]"}`} data-profile-pref-color={tag} key={tag} onClick={() => setPrefDraft({ ...prefDraft, colorTags: active ? prefDraft.colorTags.filter((item) => item !== tag) : [...prefDraft.colorTags, tag] })} type="button">
                        <span className="h-3.5 w-3.5 rounded-full border border-black/8" style={{ background: COLOR_SWATCHES[tag] }} />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button className="min-h-11 flex-1 rounded-xl border border-[var(--border)] text-sm text-[var(--muted)]" data-profile-action="pref-cancel" onClick={() => setPrefDraft(null)} type="button">取消</button>
              <button className="min-h-11 flex-1 rounded-xl bg-[var(--accent-deep)] text-sm text-white" data-profile-action="pref-save" onClick={() => savePreferences(prefDraft)} type="button">保存</button>
            </div>
          </div>
        </div>
      ) : null}

      {addressDraft ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label={addressDraft.id ? "编辑地址" : "新增地址"}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-white p-5">
            <h2 className="text-base font-medium">{addressDraft.id ? "编辑地址" : "新增地址"}</h2>
            <div className="mt-4 space-y-3">
              {([["name", "收件人"], ["phone", "联系电话"], ["region", "省市地区"], ["detail", "详细地址"]] as const).map(([field, label]) => (
                <label className="block text-sm" key={field}>
                  <span className="text-xs text-[var(--muted)]">{label}</span>
                  <input className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] px-3 outline-none focus:border-[var(--accent)]" data-profile-address-input={field} onChange={(event) => setAddressDraft({ ...addressDraft, [field]: event.target.value })} value={addressDraft[field] ?? ""} />
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm">
                <input checked={addressDraft.isDefault ?? false} className="h-4 w-4 accent-[var(--accent-deep)]" onChange={(event) => setAddressDraft({ ...addressDraft, isDefault: event.target.checked })} type="checkbox" />
                设为默认地址
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button className="min-h-11 flex-1 rounded-xl border border-[var(--border)] text-sm text-[var(--muted)]" data-profile-action="address-cancel" onClick={() => setAddressDraft(null)} type="button">取消</button>
              <button className="min-h-11 flex-1 rounded-xl bg-[var(--accent-deep)] text-sm text-white" data-profile-action="address-save" onClick={submitAddress} type="button">保存</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
