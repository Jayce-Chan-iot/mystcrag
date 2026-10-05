"use client";

import * as React from "react";

import type {
  CatalogMaterialProduct,
  CreateDiyFirstBeadRequest,
  CreateDiyFirstBeadResponse,
  Currency,
  Locale
} from "@mystcrag/design-contract";

import { FlowNotice } from "../../../components/flow-notice";
import { designApi } from "../../../lib/api/design-api";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import type { DisplayTrayMaterial } from "../model/display-tray";
import { CrystalBeadImage } from "./crystal-bead-image";
import { DisplayTray } from "./display-tray";
import { DIY_LAYOUT_CLASS } from "./diy-editor";

/**
 * A brand-new DIY draft has no server-side representation at all: no design id,
 * no revision, no quote and no bead until Backend accepts the first real catalog
 * bead. Everything here is therefore a transient client intent, and the only
 * mutation it can perform is the idempotent first-bead request below.
 */

export const DIY_EMPTY_TRAY_REQUEST_PREFIX = "first-bead";

/** The working size a new tray starts from; it is never a measured wrist. */
export const DIY_EMPTY_TRAY_WORKING_SIZE_MM = 155;

const DIY_EMPTY_TRAY_DEFAULT_MATERIAL: DisplayTrayMaterial = "BONE_CHINA";

const DIY_EMPTY_TRAY_SELECTIONS: Array<{ locale: Locale; currency: Currency; label: string }> = [
  { locale: "zh-CN", currency: "CNY", label: "人民币 ¥" },
  { locale: "zh-TW", currency: "TWD", label: "新台币 NT$" }
];

export type DiyEmptySelection = { locale: Locale; currency: Currency };

export type DiyFirstBeadIntent = CreateDiyFirstBeadRequest;

export type DiyFirstBeadStatus = "EMPTY" | "CREATING" | "ERROR";

export type DiyFirstBeadWorkbenchState = {
  status: DiyFirstBeadStatus;
  intent: DiyFirstBeadIntent | null;
  noticeCode: FrontendErrorCode | null;
};

export function createFirstBeadWorkbenchState(): DiyFirstBeadWorkbenchState {
  return { status: "EMPTY", intent: null, noticeCode: null };
}

export function diyDesignHref(designId: string): string {
  return `/diy/${encodeURIComponent(designId)}`;
}

/**
 * A product with no sellable stock is never offered as a first bead, so the tray
 * cannot invite an intent that Backend would only reject.
 */
export function selectPurchasableMaterials(
  materials: readonly CatalogMaterialProduct[]
): CatalogMaterialProduct[] {
  return materials.filter((material) => material.availableQuantity > 0);
}

function sameIntent(left: DiyFirstBeadIntent, right: DiyFirstBeadIntent): boolean {
  return (
    left.beadProductId === right.beadProductId &&
    left.locale === right.locale &&
    left.currency === right.currency
  );
}

export type FirstBeadFlowDeps = {
  create(request: DiyFirstBeadIntent): Promise<CreateDiyFirstBeadResponse>;
  navigate(href: string): void;
  createRequestId(): string;
  initialSelection: DiyEmptySelection;
};

export type FirstBeadFlow = {
  readonly state: DiyFirstBeadWorkbenchState;
  readonly selection: DiyEmptySelection;
  subscribe(listener: () => void): () => void;
  setSelection(selection: DiyEmptySelection): void;
  pickBead(beadProductId: string): Promise<void>;
  retry(): Promise<void>;
  dismiss(): void;
};

/**
 * Owns one first-bead intent. The request key is created per intent, reused by a
 * double click and by every retry of the same intent, and dropped only when the
 * durable request actually changes (a different bead, language or currency).
 * A language or currency choice alone never reaches the network.
 */
export function createFirstBeadFlow(deps: FirstBeadFlowDeps): FirstBeadFlow {
  let state = createFirstBeadWorkbenchState();
  let selection = deps.initialSelection;
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of [...listeners]) listener();
  };

  const submit = async (intent: DiyFirstBeadIntent): Promise<void> => {
    state = { ...state, status: "CREATING", intent, noticeCode: null };
    publish();
    try {
      const response = await deps.create(intent);
      state = createFirstBeadWorkbenchState();
      publish();
      deps.navigate(diyDesignHref(response.design.designId));
    } catch (error) {
      state = { status: "ERROR", intent, noticeCode: toFrontendApiError(error).code };
      publish();
    }
  };

  return {
    get state() {
      return state;
    },
    get selection() {
      return selection;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSelection(next) {
      if (state.status === "CREATING") return;
      if (selection.locale === next.locale && selection.currency === next.currency) return;
      selection = next;
      state = createFirstBeadWorkbenchState();
      publish();
    },
    async pickBead(beadProductId) {
      if (state.status === "CREATING") return;
      const candidate: DiyFirstBeadIntent = {
        requestId: "",
        beadProductId,
        locale: selection.locale,
        currency: selection.currency
      };
      const reusable = state.intent && sameIntent(state.intent, candidate) ? state.intent.requestId : "";
      await submit({ ...candidate, requestId: reusable || deps.createRequestId() });
    },
    async retry() {
      if (state.status === "CREATING" || !state.intent) return;
      await submit(state.intent);
    },
    dismiss() {
      if (state.status !== "ERROR") return;
      state = { ...state, status: "EMPTY", noticeCode: null };
      publish();
    }
  };
}

function useFirstBeadFlow(flow: FirstBeadFlow): DiyFirstBeadWorkbenchState {
  return React.useSyncExternalStore(flow.subscribe, () => flow.state, () => flow.state);
}

export type DiyEmptyTrayFrameProps = {
  materials: readonly CatalogMaterialProduct[];
  selection: DiyEmptySelection;
  status: DiyFirstBeadWorkbenchState;
  onSelectionChange(selection: DiyEmptySelection): void;
  onPickBead(beadProductId: string): void;
  onRetry(): void;
  onDismissNotice?(): void;
};

/**
 * The empty workbench mirrors the existing mobile DIY composition surface: the
 * same tray material, the same width and the same catalog rail — with zero beads,
 * zero price and no design identity until the first bead is accepted.
 */
export function DiyEmptyTrayFrame({
  materials,
  selection,
  status,
  onSelectionChange,
  onPickBead,
  onRetry,
  onDismissNotice
}: DiyEmptyTrayFrameProps) {
  const creating = status.status === "CREATING";
  const trayMaterial = DIY_EMPTY_TRAY_DEFAULT_MATERIAL;

  return (
    <main
      className={`${DIY_LAYOUT_CLASS} px-4 pb-24 pt-5 sm:px-5 lg:pb-8`}
      data-diy-empty-workbench="true"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">开始一副新的手串</h1>
          <p className="mt-1 text-sm text-[var(--muted)]" data-diy-empty-tray-hint="true">
            托盘现在是空的。先选择第一颗珠子，之后才会创建你的设计。
          </p>
        </div>
        <div className="flex items-center gap-1" data-diy-empty-selection="true" role="group">
          {DIY_EMPTY_TRAY_SELECTIONS.map((option) => {
            const active = option.currency === selection.currency && option.locale === selection.locale;
            return (
              <button
                aria-pressed={active}
                className={`min-h-11 rounded-full border px-3 text-xs transition ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-deep)]"
                    : "border-[var(--border)] bg-white text-[var(--muted)]"
                }`}
                data-diy-empty-locale={option.locale}
                disabled={creating}
                key={option.locale}
                onClick={() => onSelectionChange({ locale: option.locale, currency: option.currency })}
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </header>

      {status.status === "ERROR" && status.noticeCode ? (
        <div className="mt-4">
          <FlowNotice
            code={status.noticeCode}
            action={{ kind: "button", label: "重试这颗首珠", onAction: onRetry }}
            onDismissAuthRequired={onDismissNotice}
          />
          <button
            className="mt-3 flex min-h-11 items-center rounded-full border border-[var(--border)] bg-white px-4 text-xs text-[var(--muted)]"
            data-diy-empty-retry="true"
            onClick={onRetry}
            type="button"
          >
            这颗珠子刚刚不可用时也可以换一个再试，托盘仍然保持为空
          </button>
        </div>
      ) : null}

      <section
        className="mt-4 rounded-3xl border border-[var(--border)] bg-white/90 p-4"
        data-atelier-surface="diy-workbench"
        data-diy-empty-tray="true"
        data-empty-tray-bead-count="0"
      >
        <div className="relative mx-auto aspect-[4/3] w-full max-w-[26rem]">
          <DisplayTray material={trayMaterial} />
          <p
            className="absolute inset-x-0 bottom-3 text-center text-xs text-[var(--muted)]"
            data-empty-tray-placeholder="true"
          >
            空托盘 · 还没有珠子 · 待确认的工作尺寸 {DIY_EMPTY_TRAY_WORKING_SIZE_MM} mm
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            aria-disabled="true"
            data-diy-empty-action="save"
            disabled
            className="min-h-11 rounded-full border border-[var(--border)] bg-white px-4 text-sm text-[var(--muted)]"
            type="button"
          >
            保存设计
          </button>
          <button
            aria-disabled="true"
            data-diy-empty-action="finish"
            disabled
            className="min-h-11 rounded-full bg-[var(--accent-deep)] px-5 text-sm text-white opacity-60"
            type="button"
          >
            完成设计
          </button>
          <p className="w-full text-right text-xs text-[var(--muted)]" data-diy-empty-action-hint="true">
            先选择第一颗珠子后，保存与完成才可用。
          </p>
        </div>
      </section>

      <section
        className="mt-4 rounded-3xl border border-[var(--border)] bg-white/90 p-4"
        data-diy-empty-catalog="true"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-[var(--foreground)]">选择第一颗珠子</h2>
          <p className="text-xs text-[var(--muted)]" data-diy-empty-catalog-count="true">
            {materials.length} 款在售目录珠可选
          </p>
        </div>
        {materials.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--muted)]" data-diy-empty-catalog-loading="true">
            正在读取当前目录，确认后可以点选第一颗珠子。
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {materials.map((material) => (
              <li key={material.beadProductId}>
                <button
                  className="flex min-h-11 w-full flex-col items-center gap-1 rounded-2xl border border-[var(--border)] bg-white px-2 py-3 text-center transition hover:border-[var(--accent)] disabled:opacity-60"
                  data-first-bead-product={material.beadProductId}
                  disabled={creating}
                  onClick={() => onPickBead(material.beadProductId)}
                  type="button"
                >
                  <span className="h-12 w-12">
                    <CrystalBeadImage
                      alt={material.displayName}
                      materialKey={material.materialKey}
                      sizes="48px"
                      textureAssetKey={material.textureAssetKey}
                    />
                  </span>
                  <span className="text-xs text-[var(--foreground)]">{material.crystalNameCn}</span>
                  <span className="text-[0.65rem] text-[var(--muted)]">{material.diameterMm}mm</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export type DiyEmptyWorkbenchProps = {
  navigate(href: string): void;
  api?: typeof designApi;
};

/** The only container that can turn the empty tray into a design: one bead, one key. */
export function DiyEmptyWorkbench({ navigate, api = designApi }: DiyEmptyWorkbenchProps) {
  const [flow] = React.useState(() =>
    createFirstBeadFlow({
      create: (request) => api.createDiyFirstBead(request),
      navigate,
      createRequestId: () =>
        `${DIY_EMPTY_TRAY_REQUEST_PREFIX}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`}`,
      initialSelection: { locale: "zh-CN", currency: "CNY" }
    })
  );
  const status = useFirstBeadFlow(flow);
  const [catalog, setCatalog] = React.useState<CatalogMaterialProduct[]>([]);
  const { currency } = flow.selection;

  React.useEffect(() => {
    let active = true;
    void api
      .materials(currency)
      .then((response) => {
        if (active) setCatalog(selectPurchasableMaterials(response.materials));
      })
      .catch(() => {
        // The tray stays empty and truthful: a catalog that cannot be read must not
        // invent selectable beads, and it never creates a design either.
        if (active) setCatalog([]);
      });
    return () => {
      active = false;
    };
  }, [api, currency]);

  return (
    <DiyEmptyTrayFrame
      materials={catalog}
      onPickBead={(beadProductId) => {
        void flow.pickBead(beadProductId);
      }}
      onRetry={() => {
        void flow.retry();
      }}
      onSelectionChange={(selection) => flow.setSelection(selection)}
      onDismissNotice={() => flow.dismiss()}
      selection={flow.selection}
      status={status}
    />
  );
}
