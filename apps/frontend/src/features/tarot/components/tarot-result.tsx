"use client";

import type {
  CreateTarotSessionResponse,
  GenerateTarotRecommendationsResponse,
  GetTarotSessionResponse,
  SaveTarotSessionResponse,
  TarotPublicSession
} from "@mystcrag/design-contract";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ERROR_PRESENTATION, toFrontendApiError } from "../../../lib/api/frontend-api-error";
import { tarotApi, type TarotApiClient } from "../../../lib/api/tarot-api";
import { tarotStyles as styles } from "../tarot-styles";
import {
  useTarotQuestionDraftStore,
  type TarotQuestionDraft,
  type TarotQuestionDraftStore
} from "./tarot-question-draft-provider";
import { TarotRecommendationCard } from "./tarot-recommendation-card";

export type TarotResultClient = Pick<TarotApiClient, "create" | "get" | "recommendations" | "save">;

export type TarotResultState = Readonly<{
  session: TarotPublicSession | null;
  loading: boolean;
  generating: boolean;
  saving: boolean;
  redrawing: boolean;
  needsQuestionRecovery: boolean;
  selectedDesignId: string;
  error: string | null;
}>;

type TarotResultCoordinatorDependencies = Readonly<{
  sessionId: string;
  client: TarotResultClient;
  draftStore: TarotQuestionDraftStore;
  navigate(path: string): void;
  requestId(): string;
}>;

function errorMessage(error: unknown): string {
  const presentation = ERROR_PRESENTATION[toFrontendApiError(error).code];
  return `${presentation.title}：${presentation.message}`;
}

function initialSelectedDesignId(session: TarotPublicSession): string {
  return session.selectedDesignId ?? session.recommendations?.[0]?.design.designId ?? "";
}

export function createTarotResultCoordinator(dependencies: TarotResultCoordinatorDependencies) {
  let state: TarotResultState = {
    session: null,
    loading: true,
    generating: false,
    saving: false,
    redrawing: false,
    needsQuestionRecovery: false,
    selectedDesignId: "",
    error: null
  };
  let generation = 0;
  let disposed = false;
  let recommendationInFlight: Promise<void> | null = null;
  let saveInFlight: Promise<void> | null = null;
  let redrawInFlight: Promise<void> | null = null;
  let navigateAfterSave = false;
  const listeners = new Set<(nextState: TarotResultState) => void>();
  const current = (token: number) => !disposed && token === generation;
  const begin = () => ++generation;
  const publish = (patch: Partial<TarotResultState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const applySession = (session: TarotPublicSession, patch: Partial<TarotResultState> = {}) => {
    publish({
      session,
      selectedDesignId: initialSelectedDesignId(session),
      loading: false,
      ...patch
    });
  };
  const restoreForReconciliation = async (token: number): Promise<GetTarotSessionResponse | undefined> => {
    const response = await dependencies.client.get(dependencies.sessionId);
    if (!current(token)) return undefined;
    applySession(response.session);
    return response;
  };

  const recommend = (
    session: TarotPublicSession,
    draft: TarotQuestionDraft | undefined,
    requestedToken?: number
  ): Promise<void> => {
    if (recommendationInFlight !== null) return recommendationInFlight;
    const token = requestedToken ?? begin();
    const question = draft?.question.trim() ?? "";
    publish({ generating: true, needsQuestionRecovery: false, error: null });
    recommendationInFlight = (async () => {
      try {
        const response: GenerateTarotRecommendationsResponse =
          await dependencies.client.recommendations(dependencies.sessionId, {
            requestId: dependencies.requestId(),
            expectedRevision: session.revision,
            ...(question ? { question } : {}),
            saveQuestion: question ? draft?.saveQuestion ?? false : false,
            locale: "zh-CN",
            currency: "CNY"
          });
        if (current(token)) applySession(response.session, { generating: false });
      } catch (error) {
        if (!current(token)) return;
        const code = toFrontendApiError(error).code;
        if (code === "CONFLICT" || code === "NETWORK_ERROR" || code === "INTERNAL_ERROR") {
          try {
            const restored = await restoreForReconciliation(token);
            if (!restored || !current(token)) return;
            if (restored.session.status === "RECOMMENDED" || restored.session.status === "SAVED") {
              publish({ generating: false, error: "服务器已完成推荐，已同步最新结果。" });
            } else {
              publish({
                generating: false,
                needsQuestionRecovery: true,
                error: code === "CONFLICT" ? "牌阵状态已更新，请再次继续。" : "还无法确认推荐是否生成，请重试。"
              });
            }
          } catch (restoreError) {
            if (current(token)) publish({ generating: false, error: errorMessage(restoreError) });
          }
        } else {
          publish({ generating: false, needsQuestionRecovery: true, error: errorMessage(error) });
        }
      } finally {
        recommendationInFlight = null;
      }
    })();
    return recommendationInFlight;
  };

  const persistSelection = (enterDiy: boolean): Promise<void> => {
    if (enterDiy) navigateAfterSave = true;
    if (saveInFlight !== null) return saveInFlight;
    const session = state.session;
    const selectedDesignId = state.selectedDesignId;
    if (!session || !selectedDesignId || state.generating || state.redrawing) return Promise.resolve();
    if (session.status === "SAVED") {
      if (enterDiy && session.selectedDesignId) {
        dependencies.navigate(`/diy/${encodeURIComponent(session.selectedDesignId)}`);
      }
      return Promise.resolve();
    }
    if (session.status !== "RECOMMENDED") return Promise.resolve();

    const token = begin();
    publish({ saving: true, error: null });
    saveInFlight = (async () => {
      try {
        const response: SaveTarotSessionResponse = await dependencies.client.save(
          dependencies.sessionId,
          {
            requestId: dependencies.requestId(),
            expectedRevision: session.revision,
            selectedDesignId
          }
        );
        if (!current(token)) return;
        applySession(response.session, { saving: false });
        if (navigateAfterSave) {
          dependencies.navigate(`/diy/${encodeURIComponent(response.session.selectedDesignId ?? selectedDesignId)}`);
        }
      } catch (error) {
        if (!current(token)) return;
        const code = toFrontendApiError(error).code;
        if (code === "CONFLICT" || code === "NETWORK_ERROR" || code === "INTERNAL_ERROR") {
          try {
            const restored = await restoreForReconciliation(token);
            if (!restored || !current(token)) return;
            const committed = restored.session.status === "SAVED" &&
              restored.session.selectedDesignId === selectedDesignId;
            if (committed) {
              publish({ saving: false, error: "服务器已保存这个方案，已同步最新状态。" });
              if (navigateAfterSave) dependencies.navigate(`/diy/${encodeURIComponent(selectedDesignId)}`);
            } else {
              publish({ saving: false, error: "服务器已保存其他选择，已为你同步。" });
            }
          } catch (restoreError) {
            if (current(token)) publish({ saving: false, error: errorMessage(restoreError) });
          }
        } else {
          publish({ saving: false, error: errorMessage(error) });
        }
      } finally {
        saveInFlight = null;
        navigateAfterSave = false;
      }
    })();
    return saveInFlight;
  };

  return {
    getState: () => state,
    subscribe(listener: (nextState: TarotResultState) => void) {
      disposed = false;
      listeners.add(listener);
      return () => listeners.delete(listener);
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
        const response = await dependencies.client.get(dependencies.sessionId);
        if (!current(token)) return;
        const session = response.session;
        if (session.status === "DRAWING") {
          dependencies.navigate(`/tarot/draw/${encodeURIComponent(dependencies.sessionId)}`);
          return;
        }
        applySession(session);
        if (session.status === "DRAWN") {
          const draft = dependencies.draftStore.get(dependencies.sessionId);
          if (draft === undefined) {
            publish({ needsQuestionRecovery: true });
          } else {
            await recommend(session, draft, token);
          }
        }
      } catch (error) {
        if (current(token)) publish({ loading: false, generating: false, error: errorMessage(error) });
      }
    },
    continueWithQuestion(question: string) {
      const session = state.session;
      if (!session || session.status !== "DRAWN") return Promise.resolve();
      const trimmed = question.trim();
      if (trimmed.length > 120) {
        publish({ error: "问题最多 120 个字符。" });
        return Promise.resolve();
      }
      return recommend(session, { question: trimmed, saveQuestion: false });
    },
    continueWithoutQuestion() {
      const session = state.session;
      if (!session || session.status !== "DRAWN") return Promise.resolve();
      return recommend(session, { question: "", saveQuestion: false });
    },
    selectDesign(designId: string) {
      const session = state.session;
      if (!session || session.status === "SAVED" || state.saving ||
        !session.recommendations?.some((item) => item.design.designId === designId)) return;
      publish({ selectedDesignId: designId, error: null });
    },
    saveSelected() {
      return persistSelection(false);
    },
    saveAndEnterDiy() {
      return persistSelection(true);
    },
    redraw() {
      if (redrawInFlight !== null) return redrawInFlight;
      const session = state.session;
      if (!session || state.generating || state.saving) return Promise.resolve();
      const token = begin();
      publish({ redrawing: true, error: null });
      redrawInFlight = (async () => {
        try {
          const response: CreateTarotSessionResponse = await dependencies.client.create({
            requestId: dependencies.requestId(),
            spreadType: session.spreadType,
            theme: session.theme,
            parentSessionId: session.sessionId
          });
          if (!current(token)) return;
          const draft = dependencies.draftStore.get(session.sessionId);
          if (draft !== undefined) dependencies.draftStore.set(response.session.sessionId, draft);
          dependencies.navigate(`/tarot/draw/${encodeURIComponent(response.session.sessionId)}`);
        } catch (error) {
          if (current(token)) publish({ redrawing: false, error: errorMessage(error) });
        } finally {
          redrawInFlight = null;
        }
      })();
      return redrawInFlight;
    }
  };
}

const SLOT_LABELS = { GUIDANCE: "指引", PAST: "过去", PRESENT: "现在", FUTURE: "未来" } as const;
const ORIENTATION_LABELS = { UPRIGHT: "正位", REVERSED: "逆位" } as const;
const THEME_LABELS = {
  RELATIONSHIPS: "关系与相处", CAREER: "事业与方向", SELF_GROWTH: "自我成长",
  NEW_BEGINNINGS: "新的开始", FINANCIAL_PLANNING: "财务规划"
} as const;

export type TarotResultViewProps = Readonly<{
  session: TarotPublicSession;
  selectedDesignId: string;
  generating: boolean;
  saving: boolean;
  redrawing: boolean;
  error: string | null;
  needsQuestionRecovery?: boolean;
  recoveryQuestion?: string;
  onRecoveryQuestionChange?(value: string): void;
  onContinueQuestion?(): void;
  onSkipQuestion?(): void;
  onSelect(designId: string): void;
  onSave(): void;
  onSelectAndEnterDiy(): void;
  onRedraw(): void;
}>;

export function TarotResultView({
  session,
  selectedDesignId,
  generating,
  saving,
  redrawing,
  error,
  needsQuestionRecovery = false,
  recoveryQuestion = "",
  onRecoveryQuestionChange,
  onContinueQuestion,
  onSkipQuestion,
  onSelect,
  onSave,
  onSelectAndEnterDiy,
  onRedraw
}: TarotResultViewProps) {
  const interpretation = session.interpretation;
  const recommendations = session.recommendations ?? [];
  const busy = generating || saving || redrawing;
  const selectedDesign = recommendations.find((item) => item.design.designId === selectedDesignId)?.design;

  return (
    <main className={styles.resultPage} data-results-layout="three-visible-no-carousel">
      <header className={styles.resultHeader}>
        <p>{session.spreadType === "SINGLE" ? "单张指引解读" : "三张塔罗牌解读"}</p>
        <h1>{interpretation?.headline ?? "牌面已揭晓，准备展开设计灵感"}</h1>
        <span>{interpretation?.summary ?? "我们会根据这次牌面，组织色彩、材质与手串方案。"}</span>
      </header>

      <section className={styles.readingStage} aria-label="本次塔罗解读">
        <div className={styles.readingCards} data-card-count={session.revealedCards?.length ?? 0}>
          {session.revealedCards?.map((card) => {
            const reflection = interpretation?.cardReflections.find((item) => item.slot === card.slot)?.reflection;
            return (
              <article className={styles.readingCard} key={card.slot}>
                <h2>{SLOT_LABELS[card.slot]}</h2>
                <div className={styles.readingArtworkFrame} data-orientation={card.orientation}>
                  <Image
                    alt={`${card.nameZh} ${ORIENTATION_LABELS[card.orientation]}`}
                    className={styles.readingArtwork}
                    height={1376}
                    priority
                    src={`/tarot/cards/${card.assetFile}`}
                    style={{ transform: card.orientation === "REVERSED" ? "rotate(180deg)" : undefined }}
                    width={784}
                  />
                </div>
                <p className={styles.cardIdentity}>{card.nameZh} · {ORIENTATION_LABELS[card.orientation]}</p>
                {reflection ? <p className={styles.cardReflection}>{reflection}</p> : null}
              </article>
            );
          })}
        </div>

        {interpretation && session.colorStory ? (
          <div className={styles.readingSummary}>
            <p>{interpretation.designRationale}</p>
            <div className={styles.colorStory} aria-label="塔罗配色建议">
              {[
                ["主色", session.colorStory.primaryColor],
                ["辅色", session.colorStory.supportColor],
                ["点缀色", session.colorStory.accentColor]
              ].map(([label, color]) => (
                <span key={label}><i style={{ backgroundColor: color }} />{label} {color}</span>
              ))}
            </div>
            <p>{session.colorStory.rationale}</p>
            <div className={styles.materialRecommendations}>
              {session.materialRecommendations?.map((material) => (
                <span key={material.beadProductId} title={material.reason}>{material.displayName}</span>
              ))}
            </div>
            <p className={styles.disclaimer}>{interpretation.disclaimer}</p>
            <p className={styles.fallbackNotice}>
              解读文案会经过安全校验；服务不可用时会自动使用本地安全文案。
            </p>
          </div>
        ) : null}
      </section>

      {needsQuestionRecovery ? (
        <section className={styles.questionRecovery} aria-labelledby="tarot-recovery-title">
          <p className={styles.eyebrow}>继续本次解读</p>
          <h2 id="tarot-recovery-title">想问的问题（可选）</h2>
          <p>未保存的问题不会从服务器恢复。如果页面刚刚刷新或生成未完成，可以重新输入，也可以直接跳过。</p>
          <textarea
            maxLength={120}
            onChange={(event) => onRecoveryQuestionChange?.(event.target.value)}
            placeholder="例如：我该如何整理接下来的方向？"
            value={recoveryQuestion}
          />
          <div><button disabled={generating} onClick={onSkipQuestion} type="button">跳过</button><button disabled={generating} onClick={onContinueQuestion} type="button">继续</button></div>
        </section>
      ) : null}

      {generating ? <p className={styles.resultStatus} aria-live="polite">正在从牌面中整理配色与手串方案…
      </p> : null}
      {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}

      {recommendations.length === 3 ? (
        <section className={styles.recommendationSection} aria-labelledby="tarot-recommendations-title">
          <div className={styles.recommendationHeading}>
            <div><p>本次主题 · {THEME_LABELS[session.theme]}</p><h2 id="tarot-recommendations-title">选择一个手串方案</h2></div>
            <span>三个方案均可进入 DIY 继续调整。</span>
          </div>
          <div className={styles.recommendationGrid}>
            {recommendations.map(({ rank, design }) => (
              <TarotRecommendationCard
                design={design}
                disabled={busy || session.status === "SAVED"}
                key={design.designId}
                onSelect={onSelect}
                rank={rank}
                selected={selectedDesignId === design.designId}
              />
            ))}
          </div>
        </section>
      ) : null}

      {selectedDesign ? (
        <footer className={styles.resultActions}>
          <button className={styles.secondaryAction} disabled={busy || session.status === "SAVED"} onClick={onSave} type="button">
            {session.status === "SAVED" ? "已保存本次设计" : saving ? "正在保存…" : "保存本次设计"}
          </button>
          <button className={styles.primaryAction} disabled={busy} onClick={onSelectAndEnterDiy} type="button">
            {saving ? "正在保存选择…" : "选择方案并进入 DIY"} <span aria-hidden="true">→</span>
          </button>
          <button className={styles.secondaryAction} disabled={busy} onClick={onRedraw} type="button">
            {redrawing ? "正在准备新牌阵…" : "重新抽牌"}
          </button>
        </footer>
      ) : null}
    </main>
  );
}

export function TarotResult({
  sessionId,
  client = tarotApi
}: Readonly<{ sessionId: string; client?: TarotResultClient }>) {
  const router = useRouter();
  const draftStore = useTarotQuestionDraftStore();
  const coordinator = useMemo(() => createTarotResultCoordinator({
    sessionId,
    client,
    draftStore,
    navigate: (path) => router.push(path),
    requestId: () => crypto.randomUUID()
  }), [client, draftStore, router, sessionId]);
  const [state, setState] = useState<TarotResultState>(coordinator.getState());
  const [recoveryQuestion, setRecoveryQuestion] = useState("");

  useEffect(() => {
    const unsubscribe = coordinator.subscribe(setState);
    void coordinator.restore();
    return () => {
      unsubscribe();
      coordinator.dispose();
    };
  }, [coordinator]);

  if (state.loading || state.session === null) {
    return (
      <main className={styles.loadingPage}>
        <p aria-live="polite">{state.error ?? "正在恢复本次解读…"}</p>
        {state.error ? <button onClick={() => void coordinator.restore()} type="button">重试</button> : null}
      </main>
    );
  }

  return (
    <TarotResultView
      error={state.error}
      generating={state.generating}
      needsQuestionRecovery={state.needsQuestionRecovery}
      onContinueQuestion={() => void coordinator.continueWithQuestion(recoveryQuestion)}
      onRecoveryQuestionChange={setRecoveryQuestion}
      onRedraw={() => void coordinator.redraw()}
      onSave={() => void coordinator.saveSelected()}
      onSelect={(designId) => coordinator.selectDesign(designId)}
      onSelectAndEnterDiy={() => void coordinator.saveAndEnterDiy()}
      onSkipQuestion={() => void coordinator.continueWithoutQuestion()}
      recoveryQuestion={recoveryQuestion}
      redrawing={state.redrawing}
      saving={state.saving}
      selectedDesignId={state.selectedDesignId}
      session={state.session}
    />
  );
}
