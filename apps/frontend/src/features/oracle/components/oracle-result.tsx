"use client";

import type { OraclePublicSession, PublicDesignV1 } from "@mystcrag/design-contract";

import { BraceletPreview } from "../../design/components/bracelet-preview";
import { formatMinorAmount } from "../../design/model/format-minor-amount";
import type { OracleCoordinatorSnapshot } from "../oracle-coordinator";
import { getOracleRevealPlan, OracleReveal, type OracleRevealPlan } from "./oracle-reveal";

export { getOracleRevealPlan };

export type OracleRecommendationsState = "loading" | "ready" | "error";

const DIRECTION_LABELS: Record<string, string> = {
  BALANCED: "平衡",
  CONTRAST: "对照",
  NEUTRAL_LED: "中性引导"
};

export type OracleDesignCardProps = Readonly<{
  design: PublicDesignV1;
  rank: number;
  direction: string;
  selected: boolean;
  onSelect(designId: string): void;
}>;

export function OracleDesignCard({
  design,
  rank,
  direction,
  selected,
  onSelect
}: OracleDesignCardProps) {
  const price = formatMinorAmount({
    amountMinor: design.pricing.totalPriceMinor,
    currency: design.currency,
    locale: design.locale
  });

  return (
    <article
      className="oracleDesignCard"
      data-design-selected={selected}
      data-oracle-design-card={rank}
    >
      <button
        aria-label={selected ? `已选择 ${design.designName}` : `选择 ${design.designName}`}
        aria-pressed={selected}
        className="oracleDesignCardSelect"
        onClick={() => onSelect(design.designId)}
        type="button"
      >
        <span aria-hidden="true">{String(rank).padStart(2, "0")}</span>
        <strong>{design.designName}</strong>
        <span>{DIRECTION_LABELS[direction] ?? direction}</span>
      </button>
      <div className="oracleDesignPreview">
        <BraceletPreview compact design={design} />
      </div>
      <div className="oracleDesignBody">
        <p>{design.story.designStory}</p>
        <p className="oracleDesignPrice" data-oracle-design-price={design.pricing.totalPriceMinor}>
          {price}
        </p>
      </div>
    </article>
  );
}

export type OracleResultBodyProps = Readonly<{
  session: OraclePublicSession;
  selectedDesignId: string | null;
  recommendationsState: OracleRecommendationsState;
  revealProgress: number;
  fullMotion: boolean;
  detailsOpen: boolean;
  onToggleDetails(): void;
  onSelectDesign(designId: string): void;
  onEnterDesign(): void;
  onRetryRecommendations(): void;
}>;

export function OracleResultBody({
  session,
  selectedDesignId,
  recommendationsState,
  revealProgress,
  fullMotion,
  detailsOpen,
  onToggleDetails,
  onSelectDesign,
  onEnterDesign,
  onRetryRecommendations
}: OracleResultBodyProps) {
  const interpretation = session.interpretation;
  const cast = session.cast;
  const transformed = cast.transformedHexagram;
  const recommendations = session.recommendations ?? [];

  return (
    <div className="oracleRevealStage" data-oracle-result-body="true">
      <OracleReveal
        lines={cast.lines}
        movingLineIndices={cast.movingLineIndices}
        plan={{ mode: fullMotion ? "full" : "short", durationMs: fullMotion ? 3200 : 400 }}
        primaryNameZh={cast.primaryHexagram.nameZh}
        revealProgress={revealProgress}
        transformedNameZh={transformed?.nameZh}
      />

      <section className="oracleInterpretation" aria-labelledby="oracle-headline">
        <h2 id="oracle-headline">{interpretation.headline}</h2>
        <p>{interpretation.summary}</p>
        <ul className="oracleKeywordRow" aria-label="三个观察关键词">
          {interpretation.keywords.map((keyword) => (
            <li className="oracleKeyword" data-oracle-keyword={keyword} key={keyword}>
              {keyword}
            </li>
          ))}
        </ul>
        <p>{interpretation.disclaimer}</p>
      </section>

      <details className="oracleDisclosure" open={detailsOpen} onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (next !== detailsOpen) onToggleDetails();
      }}>
        <summary>查看卦象详情</summary>
        <div className="oracleDisclosurePanel">
          <p>
            本卦 {cast.primaryHexagram.nameZh}（{cast.primaryHexagram.lowerTrigram} / {cast.primaryHexagram.upperTrigram}）
            {transformed ? ` · 变卦 ${transformed.nameZh}` : " · 无动爻，仅展示本卦"}
          </p>
          <p>算法 {cast.algorithm.name} {cast.algorithm.version}；动爻 {cast.movingLineIndices.length} 处。</p>
          <p>{interpretation.designRationale}</p>
          <p>文化说明：卦象结构用于设计灵感与自我观察，不作命运判定。问题文本不进入服务器持久化记录。</p>
          <p>隐私：可选问题仅存于当前页面内存；刷新会从服务端恢复卦象，不会再次生成新的一卦。</p>
        </div>
      </details>

      {recommendationsState === "error" ? (
        <div>
          <p className="oracleInlineError" role="alert">
            水晶匹配未完成。卦象已可阅读，可仅重试匹配，不会丢弃当前卦象。
          </p>
          <button className="oracleSecondaryAction" onClick={onRetryRecommendations} type="button">
            重新匹配水晶
          </button>
        </div>
      ) : null}

      {recommendationsState === "loading" ? (
        <div aria-label="正在匹配水晶" className="oracleSkeleton" data-oracle-recommendation-skeleton="true">
          <p className="oracleStatus" aria-live="polite">正在根据卦象匹配当前目录水晶…</p>
        </div>
      ) : null}

      {recommendationsState === "ready" && recommendations.length === 3 ? (
        <section aria-label="水晶设计方向">
          <div className="oracleRecommendationGrid">
            {recommendations.map(({ rank, direction, design }) => (
              <OracleDesignCard
                design={design}
                direction={direction}
                key={design.designId}
                onSelect={onSelectDesign}
                rank={rank}
                selected={selectedDesignId === design.designId}
              />
            ))}
          </div>
        </section>
      ) : null}

      <footer className="oracleResultActions">
        <button
          className="oraclePrimaryAction"
          data-oracle-enter-design="true"
          disabled={selectedDesignId === null}
          onClick={onEnterDesign}
          type="button"
        >
          生成我的手串
        </button>
        {recommendationsState === "error" ? null : (
          <button
            className="oracleSecondaryAction"
            disabled={recommendationsState === "ready"}
            onClick={onRetryRecommendations}
            type="button"
          >
            重新匹配水晶
          </button>
        )}
      </footer>
    </div>
  );
}

export type OracleResultProps = Readonly<{
  sessionId: string;
  snapshot: OracleCoordinatorSnapshot;
  reveal: { mode: "full" | "short"; durationMs: number; revealProgress: number };
  detailsOpen: boolean;
  fullMotionEnabled: boolean;
  onToggleDetails(): void;
  onSelectDesign(designId: string): void;
  onEnterDesign(): void;
  onRetryRecommendations(): void;
  onToggleFullMotion(enabled: boolean): void;
}>;

export function recommendationsStateFromSnapshot(
  snapshot: OracleCoordinatorSnapshot
): OracleRecommendationsState {
  if (snapshot.error && snapshot.state === "error") return "error";
  if (snapshot.session?.recommendations) return "ready";
  if (snapshot.state === "error") return "error";
  return "loading";
}

export function OracleResult({
  sessionId,
  snapshot,
  reveal,
  detailsOpen,
  fullMotionEnabled,
  onToggleDetails,
  onSelectDesign,
  onEnterDesign,
  onRetryRecommendations,
  onToggleFullMotion
}: OracleResultProps) {
  const session = snapshot.session;

  return (
    <main className="oraclePage" data-oracle-result="true" data-oracle-session={sessionId}>
      <div className="oracleShell">
        <header className="oracleHero">
          <p className="oracleEyebrow">玄圭星台</p>
          <h1 className="oracleTitle">卦象已成</h1>
          <p className="oracleLede">卦象只提供设计方向。实际水晶、数量、价格与库存以商品目录与设计引擎为准。</p>
        </header>

        <label className="oracleMotionToggle">
          <input
            checked={fullMotionEnabled}
            onChange={(event) => onToggleFullMotion(event.target.checked)}
            type="checkbox"
          />
          回访时播放完整星轨动效
        </label>

        {session === null ? (
          <div className="oracleSkeleton" data-oracle-result-loading="true">
            <p className="oracleStatus" aria-live="polite">正在恢复卦象…</p>
          </div>
        ) : (
          <OracleResultBody
            detailsOpen={detailsOpen}
            fullMotion={reveal.mode === "full"}
            onEnterDesign={onEnterDesign}
            onRetryRecommendations={onRetryRecommendations}
            onSelectDesign={onSelectDesign}
            onToggleDetails={onToggleDetails}
            recommendationsState={recommendationsStateFromSnapshot(snapshot)}
            revealProgress={reveal.revealProgress}
            selectedDesignId={snapshot.selectedDesignId}
            session={session}
          />
        )}
      </div>
    </main>
  );
}

export function getOracleRevealPlanFromInput(input: {
  prefersReducedMotion: boolean;
  fullMotionEnabled: boolean;
}): OracleRevealPlan {
  return getOracleRevealPlan(input);
}
