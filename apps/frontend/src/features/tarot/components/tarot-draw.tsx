"use client";

import type {
  CreateTarotSessionResponse,
  GetTarotSessionResponse,
  RevealTarotSessionResponse,
  SelectTarotCardResponse,
  TarotCardBackMetadata,
  TarotPublicSession
} from "@mystcrag/design-contract";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ERROR_PRESENTATION, toFrontendApiError } from "../../../lib/api/frontend-api-error";
import { tarotApi, type TarotApiClient } from "../../../lib/api/tarot-api";
import { tarotStyles as styles } from "../tarot-styles";
import { TarotFan } from "./tarot-fan";
import { useTarotQuestionDraftStore } from "./tarot-question-draft-provider";
import { TarotSlots } from "./tarot-slots";

export type TarotDrawClient = Pick<TarotApiClient, "create" | "get" | "reveal" | "select">;

export type TarotDrawState = Readonly<{
  session: TarotPublicSession | null;
  cardBack: TarotCardBackMetadata | null;
  loading: boolean;
  pendingPosition: number | undefined;
  canRetrySelectionReconciliation: boolean;
  revealing: boolean;
  redrawing: boolean;
  error: string | null;
}>;

type TarotDrawCoordinatorDependencies = Readonly<{
  sessionId: string;
  client: TarotDrawClient;
  navigate(path: string): void;
  requestId(): string;
  prefersReducedMotion(): boolean;
  wait(milliseconds: number): Promise<void>;
  onRedrawSession?(parentSessionId: string, childSessionId: string): void;
}>;

function errorMessage(error: unknown): string {
  const presentation = ERROR_PRESENTATION[toFrontendApiError(error).code];
  return `${presentation.title}：${presentation.message}`;
}

export function createTarotDrawCoordinator(dependencies: TarotDrawCoordinatorDependencies) {
  let state: TarotDrawState = {
    session: null,
    cardBack: null,
    loading: true,
    pendingPosition: undefined,
    canRetrySelectionReconciliation: false,
    revealing: false,
    redrawing: false,
    error: null
  };
  let generation = 0;
  let disposed = false;
  let ambiguousSelection:
    | { displayedPosition: number; slot: TarotPublicSession["slots"][number] }
    | undefined;
  const listeners = new Set<(nextState: TarotDrawState) => void>();
  const publish = (patch: Partial<TarotDrawState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const restoreSession = async (token: number): Promise<GetTarotSessionResponse | undefined> => {
    const response = await dependencies.client.get(dependencies.sessionId);
    if (disposed || token !== generation) return undefined;
    ambiguousSelection = undefined;
    publish({
      session: response.session,
      cardBack: response.cardBack,
      loading: false,
      pendingPosition: undefined,
      canRetrySelectionReconciliation: false
    });
    return response;
  };
  const begin = () => ++generation;
  const current = (token: number) => !disposed && token === generation;
  const reconcileAmbiguousSelection = async (
    token: number,
    displayedPosition: number,
    slot: TarotPublicSession["slots"][number]
  ) => {
    try {
      const response = await dependencies.client.get(dependencies.sessionId);
      if (!current(token)) return;
      const committed = response.session.acceptedSelections.some(
        (selection) => selection.slot === slot && selection.displayedPosition === displayedPosition
      );
      ambiguousSelection = undefined;
      publish({
        session: response.session,
        loading: false,
        pendingPosition: undefined,
        canRetrySelectionReconciliation: false,
        error: committed
          ? "服务器已确认这张牌，已同步最新进度。"
          : "服务器确认这次选牌未提交，请重试。"
      });
    } catch {
      if (!current(token)) return;
      publish({
        canRetrySelectionReconciliation: true,
        error: "连接不稳定，正在确认这张牌是否已提交。恢复连接后请重试。"
      });
    }
  };

  return {
    getState: () => state,
    subscribe(listener: (nextState: TarotDrawState) => void) {
      disposed = false;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      generation += 1;
      listeners.clear();
    },
    async restore() {
      const token = begin();
      publish({ loading: true, error: null });
      try {
        const response = await restoreSession(token);
        if (response?.session.revealedCards !== undefined && current(token)) {
          dependencies.navigate(`/tarot/result/${encodeURIComponent(dependencies.sessionId)}`);
        }
      } catch (error) {
        if (current(token)) publish({ loading: false, error: errorMessage(error) });
      }
    },
    async select(displayedPosition: number) {
      const session = state.session;
      if (
        session === null ||
        state.loading ||
        state.pendingPosition !== undefined ||
        state.revealing ||
        state.redrawing ||
        session.acceptedSelections.length >= session.slots.length ||
        session.acceptedSelections.some((selection) => selection.displayedPosition === displayedPosition)
      ) return;

      const slot = session.slots[session.acceptedSelections.length];
      if (slot === undefined) return;
      const token = begin();
      ambiguousSelection = { displayedPosition, slot };
      publish({
        pendingPosition: displayedPosition,
        canRetrySelectionReconciliation: false,
        error: null
      });
      try {
        const response: SelectTarotCardResponse = await dependencies.client.select(
          dependencies.sessionId,
          {
            requestId: dependencies.requestId(),
            slot,
            displayedPosition,
            expectedRevision: session.revision,
            operationId: dependencies.requestId()
          }
        );
        if (current(token)) {
          ambiguousSelection = undefined;
          publish({
            session: response.session,
            pendingPosition: undefined,
            canRetrySelectionReconciliation: false
          });
        }
      } catch (error) {
        if (!current(token)) return;
        const code = toFrontendApiError(error).code;
        if (code === "CONFLICT") {
          try {
            await restoreSession(token);
            if (current(token)) publish({ error: "牌阵已同步到服务器上的最新进度，请继续选牌。" });
          } catch (restoreError) {
            if (current(token)) {
              ambiguousSelection = undefined;
              publish({
                pendingPosition: undefined,
                canRetrySelectionReconciliation: false,
                error: errorMessage(restoreError)
              });
            }
          }
        } else if (code === "NETWORK_ERROR" || code === "INTERNAL_ERROR") {
          await reconcileAmbiguousSelection(token, displayedPosition, slot);
        } else {
          if (current(token)) {
            ambiguousSelection = undefined;
            publish({
              pendingPosition: undefined,
              canRetrySelectionReconciliation: false,
              error: errorMessage(error)
            });
          }
        }
      }
    },
    async retrySelectionReconciliation() {
      if (
        ambiguousSelection === undefined ||
        state.pendingPosition === undefined ||
        !state.canRetrySelectionReconciliation
      ) return;
      const token = begin();
      publish({
        canRetrySelectionReconciliation: false,
        error: "正在重新确认这张牌是否已提交…"
      });
      await reconcileAmbiguousSelection(
        token,
        ambiguousSelection.displayedPosition,
        ambiguousSelection.slot
      );
    },
    async reveal() {
      const session = state.session;
      if (
        session === null || state.loading || state.revealing || state.redrawing ||
        state.pendingPosition !== undefined
      ) return;
      const remaining = session.slots.length - session.acceptedSelections.length;
      if (remaining > 0) {
        publish({ error: `还需要选择 ${remaining} 张牌，才能查看解读。` });
        return;
      }

      const token = begin();
      publish({ revealing: true, error: null });
      try {
        const response: RevealTarotSessionResponse = await dependencies.client.reveal(
          dependencies.sessionId,
          { requestId: dependencies.requestId(), expectedRevision: session.revision }
        );
        if (!current(token)) return;
        publish({ session: response.session });
        if (!dependencies.prefersReducedMotion()) await dependencies.wait(1040);
        if (current(token)) dependencies.navigate(`/tarot/result/${encodeURIComponent(dependencies.sessionId)}`);
      } catch (error) {
        if (!current(token)) return;
        if (toFrontendApiError(error).code === "CONFLICT") {
          try {
            await restoreSession(token);
            if (current(token)) publish({ revealing: false, error: "牌阵已同步，请再次确认查看解读。" });
          } catch (restoreError) {
            if (current(token)) publish({ revealing: false, error: errorMessage(restoreError) });
          }
        } else {
          publish({ revealing: false, error: errorMessage(error) });
        }
      }
    },
    async redraw() {
      const session = state.session;
      if (
        session === null || state.loading || state.redrawing || state.revealing ||
        state.pendingPosition !== undefined
      ) return;
      const token = begin();
      publish({ redrawing: true, error: null });
      try {
        const response: CreateTarotSessionResponse = await dependencies.client.create({
          requestId: dependencies.requestId(),
          spreadType: session.spreadType,
          theme: session.theme,
          parentSessionId: session.sessionId
        });
        if (!current(token)) return;
        dependencies.onRedrawSession?.(session.sessionId, response.session.sessionId);
        dependencies.navigate(`/tarot/draw/${encodeURIComponent(response.session.sessionId)}`);
      } catch (error) {
        if (current(token)) publish({ redrawing: false, error: errorMessage(error) });
      }
    }
  };
}

const THEME_LABELS = {
  RELATIONSHIPS: "关系与相处",
  CAREER: "事业与方向",
  SELF_GROWTH: "自我成长",
  NEW_BEGINNINGS: "新的开始",
  FINANCIAL_PLANNING: "财务规划"
} as const;

export type TarotDrawViewProps = Readonly<{
  session: TarotPublicSession;
  cardBackAssetFile: string;
  pendingPosition: number | undefined;
  revealing: boolean;
  redrawing?: boolean;
  canRetrySelectionReconciliation?: boolean;
  error: string | null;
  onSelect(position: number): void;
  onReveal(): void;
  onRedraw(): void;
  onRetrySelectionReconciliation?(): void;
  onBack(): void;
}>;

export function TarotDrawView({
  session,
  cardBackAssetFile,
  pendingPosition,
  revealing,
  redrawing = false,
  canRetrySelectionReconciliation = false,
  error,
  onSelect,
  onReveal,
  onRedraw,
  onRetrySelectionReconciliation = () => undefined,
  onBack
}: TarotDrawViewProps) {
  const acceptedPositions = new Set(
    session.acceptedSelections.map((selection) => selection.displayedPosition)
  );
  const complete = session.acceptedSelections.length === session.slots.length;
  const busy = pendingPosition !== undefined || revealing || redrawing;
  const count = session.acceptedSelections.length;
  const cardCountLabel = session.spreadType === "SINGLE" ? "一张牌" : "三张牌";

  return (
    <main
      className={styles.drawPage}
      data-atelier-surface="tarot-draw"
      data-tarot-draw-layout="desktop-fan-mobile-half-fan"
    >
      <aside className={styles.themeSidebar} aria-label="本次抽牌主题">
        <p className={styles.eyebrow}>塔罗指引 · 抽牌</p>
        <div className={styles.themeBlock}>
          <span>当前主题</span>
          <strong>{THEME_LABELS[session.theme]}</strong>
        </div>
        <p className={styles.sideNote}>牌面仅用于自我反思与设计灵感，不代表确定性预测。</p>
      </aside>

      <section className={styles.drawStage} aria-labelledby="tarot-draw-title">
        <div className={styles.spreadSwitch} aria-label="当前牌阵">
          <span data-active={session.spreadType === "SINGLE" || undefined}>单张指引</span>
          <span data-active={session.spreadType === "PAST_PRESENT_FUTURE" || undefined}>三张牌阵</span>
        </div>
        <header className={styles.stageHeader}>
          <h1 id="tarot-draw-title">凭直觉，选择{cardCountLabel}</h1>
          <p>牌面将在选定后依次揭晓；抽牌结果只用于灵感与自我反思。</p>
        </header>

        <TarotFan
          acceptedPositions={acceptedPositions}
          cardBackAssetFile={cardBackAssetFile}
          disabled={complete || busy}
          onSelect={onSelect}
          pendingPosition={pendingPosition}
        />
        <TarotSlots
          cardBackAssetFile={cardBackAssetFile}
          pendingPosition={pendingPosition}
          session={session}
        />

        <div className={styles.selectionStatus} aria-live="polite">
          <strong>已选择 {count} / {session.slots.length}</strong>
          <span>{complete ? "牌阵已完成，可以查看解读" : `再选择${session.slots.length - count}张牌`}</span>
        </div>
        {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
        {canRetrySelectionReconciliation ? (
          <button
            aria-label="重试确认这张牌是否已提交"
            className={styles.redrawLink}
            onClick={onRetrySelectionReconciliation}
            type="button"
          >
            重新确认选牌状态
          </button>
        ) : null}
        <button className={styles.redrawLink} disabled={busy} onClick={onRedraw} type="button">
          {redrawing ? "正在重新准备…" : "重新洗牌"}
        </button>
      </section>

      <footer className={styles.actionFooter}>
        <button className={styles.secondaryAction} disabled={busy} onClick={onBack} type="button">
          返回修改问题
        </button>
        <button
          className={styles.primaryAction}
          disabled={!complete || busy}
          onClick={onReveal}
          type="button"
        >
          {revealing ? "正在揭晓…" : "查看解读"}
        </button>
      </footer>
    </main>
  );
}

export function TarotDraw({
  sessionId,
  client = tarotApi
}: Readonly<{ sessionId: string; client?: TarotDrawClient }>) {
  const router = useRouter();
  const draftStore = useTarotQuestionDraftStore();
  const coordinator = useMemo(
    () => createTarotDrawCoordinator({
      sessionId,
      client,
      navigate: (path) => router.push(path),
      requestId: () => crypto.randomUUID(),
      prefersReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      wait: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
      onRedrawSession(parentSessionId, childSessionId) {
        const draft = draftStore.get(parentSessionId);
        if (draft !== undefined) draftStore.set(childSessionId, draft);
      }
    }),
    [client, draftStore, router, sessionId]
  );
  const [state, setState] = useState<TarotDrawState>(coordinator.getState());

  useEffect(() => {
    const unsubscribe = coordinator.subscribe(setState);
    void coordinator.restore();
    return () => {
      unsubscribe();
      coordinator.dispose();
    };
  }, [coordinator]);

  if (state.loading || state.session === null || state.cardBack === null) {
    return (
      <main className={styles.loadingPage}>
        <p aria-live="polite">{state.error ?? "正在恢复你的牌阵…"}</p>
        {state.error ? <button onClick={() => void coordinator.restore()} type="button">重试</button> : null}
      </main>
    );
  }

  return (
    <TarotDrawView
      cardBackAssetFile={state.cardBack.assetFile}
      canRetrySelectionReconciliation={state.canRetrySelectionReconciliation}
      error={state.error}
      onBack={() => {
        coordinator.dispose();
        router.push("/tarot/setup");
      }}
      onRedraw={() => void coordinator.redraw()}
      onRetrySelectionReconciliation={() => void coordinator.retrySelectionReconciliation()}
      onReveal={() => void coordinator.reveal()}
      onSelect={(position) => void coordinator.select(position)}
      pendingPosition={state.pendingPosition}
      redrawing={state.redrawing}
      revealing={state.revealing}
      session={state.session}
    />
  );
}
