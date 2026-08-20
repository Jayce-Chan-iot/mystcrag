"use client";

import type {
  CreateTarotSessionResponse,
  GetTarotSessionResponse,
  RevealTarotSessionResponse,
  SelectTarotCardResponse,
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
  loading: boolean;
  pendingPosition: number | undefined;
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
    loading: true,
    pendingPosition: undefined,
    revealing: false,
    redrawing: false,
    error: null
  };
  const listeners = new Set<(nextState: TarotDrawState) => void>();
  const publish = (patch: Partial<TarotDrawState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const restoreSession = async (): Promise<GetTarotSessionResponse> => {
    const response = await dependencies.client.get(dependencies.sessionId);
    publish({ session: response.session, loading: false, pendingPosition: undefined });
    return response;
  };

  return {
    getState: () => state,
    subscribe(listener: (nextState: TarotDrawState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async restore() {
      publish({ loading: true, error: null });
      try {
        const response = await restoreSession();
        if (response.session.revealedCards !== undefined) {
          dependencies.navigate(`/tarot/result/${encodeURIComponent(dependencies.sessionId)}`);
        }
      } catch (error) {
        publish({ loading: false, error: errorMessage(error) });
      }
    },
    async select(displayedPosition: number) {
      const session = state.session;
      if (
        session === null ||
        state.pendingPosition !== undefined ||
        state.revealing ||
        session.acceptedSelections.length >= session.slots.length ||
        session.acceptedSelections.some((selection) => selection.displayedPosition === displayedPosition)
      ) return;

      const slot = session.slots[session.acceptedSelections.length];
      if (slot === undefined) return;
      publish({ pendingPosition: displayedPosition, error: null });
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
        publish({ session: response.session, pendingPosition: undefined });
      } catch (error) {
        if (toFrontendApiError(error).code === "CONFLICT") {
          try {
            await restoreSession();
            publish({ error: "牌阵已同步到服务器上的最新进度，请继续选牌。" });
          } catch (restoreError) {
            publish({ pendingPosition: undefined, error: errorMessage(restoreError) });
          }
        } else {
          publish({ pendingPosition: undefined, error: errorMessage(error) });
        }
      }
    },
    async reveal() {
      const session = state.session;
      if (session === null || state.revealing || state.pendingPosition !== undefined) return;
      const remaining = session.slots.length - session.acceptedSelections.length;
      if (remaining > 0) {
        publish({ error: `还需要选择 ${remaining} 张牌，才能查看解读。` });
        return;
      }

      publish({ revealing: true, error: null });
      try {
        const response: RevealTarotSessionResponse = await dependencies.client.reveal(
          dependencies.sessionId,
          { requestId: dependencies.requestId(), expectedRevision: session.revision }
        );
        publish({ session: response.session });
        if (!dependencies.prefersReducedMotion()) await dependencies.wait(1040);
        dependencies.navigate(`/tarot/result/${encodeURIComponent(dependencies.sessionId)}`);
      } catch (error) {
        if (toFrontendApiError(error).code === "CONFLICT") {
          try {
            await restoreSession();
            publish({ revealing: false, error: "牌阵已同步，请再次确认查看解读。" });
          } catch (restoreError) {
            publish({ revealing: false, error: errorMessage(restoreError) });
          }
        } else {
          publish({ revealing: false, error: errorMessage(error) });
        }
      }
    },
    async redraw() {
      const session = state.session;
      if (session === null || state.redrawing) return;
      publish({ redrawing: true, error: null });
      try {
        const response: CreateTarotSessionResponse = await dependencies.client.create({
          requestId: dependencies.requestId(),
          spreadType: session.spreadType,
          theme: session.theme,
          parentSessionId: session.sessionId
        });
        dependencies.onRedrawSession?.(session.sessionId, response.session.sessionId);
        dependencies.navigate(`/tarot/draw/${encodeURIComponent(response.session.sessionId)}`);
      } catch (error) {
        publish({ redrawing: false, error: errorMessage(error) });
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
  pendingPosition: number | undefined;
  revealing: boolean;
  redrawing?: boolean;
  error: string | null;
  onSelect(position: number): void;
  onReveal(): void;
  onRedraw(): void;
  onBack(): void;
}>;

export function TarotDrawView({
  session,
  pendingPosition,
  revealing,
  redrawing = false,
  error,
  onSelect,
  onReveal,
  onRedraw,
  onBack
}: TarotDrawViewProps) {
  const acceptedPositions = new Set(
    session.acceptedSelections.map((selection) => selection.displayedPosition)
  );
  const complete = session.acceptedSelections.length === session.slots.length;
  const count = session.acceptedSelections.length;
  const cardCountLabel = session.spreadType === "SINGLE" ? "一张牌" : "三张牌";

  return (
    <main
      className={styles.drawPage}
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
          cardBackAssetFile="CardBack.png"
          disabled={complete || revealing || redrawing}
          onSelect={onSelect}
          pendingPosition={pendingPosition}
        />
        <TarotSlots pendingPosition={pendingPosition} session={session} />

        <div className={styles.selectionStatus} aria-live="polite">
          <strong>已选择 {count} / {session.slots.length}</strong>
          <span>{complete ? "牌阵已完成，可以查看解读" : `再选择${session.slots.length - count}张牌`}</span>
        </div>
        {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
        <button className={styles.redrawLink} disabled={redrawing} onClick={onRedraw} type="button">
          {redrawing ? "正在重新准备…" : "重新洗牌"}
        </button>
      </section>

      <footer className={styles.actionFooter}>
        <button className={styles.secondaryAction} onClick={onBack} type="button">
          返回修改问题
        </button>
        <button
          className={styles.primaryAction}
          disabled={!complete || revealing}
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
    return unsubscribe;
  }, [coordinator]);

  if (state.loading || state.session === null) {
    return (
      <main className={styles.loadingPage}>
        <p aria-live="polite">{state.error ?? "正在恢复你的牌阵…"}</p>
        {state.error ? <button onClick={() => void coordinator.restore()} type="button">重试</button> : null}
      </main>
    );
  }

  return (
    <TarotDrawView
      error={state.error}
      onBack={() => router.push("/tarot/setup")}
      onRedraw={() => void coordinator.redraw()}
      onReveal={() => void coordinator.reveal()}
      onSelect={(position) => void coordinator.select(position)}
      pendingPosition={state.pendingPosition}
      redrawing={state.redrawing}
      revealing={state.revealing}
      session={state.session}
    />
  );
}
