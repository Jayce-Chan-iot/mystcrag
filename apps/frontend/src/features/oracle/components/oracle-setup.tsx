"use client";

import {
  MAX_BRACELET_CIRCUMFERENCE_MM,
  MIN_BRACELET_CIRCUMFERENCE_MM
} from "../../design/model/bracelet-fit";
import type { FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import type { OracleQuestionStore } from "../oracle-question-provider";

export type OracleSetupInput = Readonly<{
  question: string;
  wristCircumferenceMm: number | undefined;
}>;

type CreateSession = (
  input: OracleSetupInput
) => Promise<{ session: { sessionId: string } }>;

export type OracleSetupSubmitterDependencies = Readonly<{
  create: CreateSession;
  questionStore: OracleQuestionStore;
  navigate(path: string): void;
}>;

function formatWristRangeCm(): string {
  return `${(MIN_BRACELET_CIRCUMFERENCE_MM / 10).toFixed(1)}–${(MAX_BRACELET_CIRCUMFERENCE_MM / 10).toFixed(1)}`;
}

export function createOracleSetupSubmitter({
  create,
  questionStore,
  navigate
}: OracleSetupSubmitterDependencies): (input: OracleSetupInput) => Promise<void> {
  let inFlight: Promise<void> | null = null;

  return (input) => {
    if (inFlight !== null) return inFlight;

    const question = input.question.trim();
    if (question.length > 120) {
      return Promise.reject(new Error("问题最多 120 个字符。"));
    }
    if (
      input.wristCircumferenceMm !== undefined &&
      (input.wristCircumferenceMm < MIN_BRACELET_CIRCUMFERENCE_MM ||
        input.wristCircumferenceMm > MAX_BRACELET_CIRCUMFERENCE_MM)
    ) {
      return Promise.reject(
        new Error(`腕围请填写 ${formatWristRangeCm()} cm（${MIN_BRACELET_CIRCUMFERENCE_MM}–${MAX_BRACELET_CIRCUMFERENCE_MM} mm）。`)
      );
    }

    questionStore.set(question);

    const attempt = (async () => {
      const response = await create({
        question,
        wristCircumferenceMm: input.wristCircumferenceMm
      });
      navigate(`/oracle/result/${encodeURIComponent(response.session.sessionId)}`);
    })();

    // The guard is held after success: navigate() is fire-and-forget, so a second
    // activation between the create settling and the route committing would otherwise
    // start a second session. Only a rejection frees it, so the user can retry.
    inFlight = attempt;
    void attempt.catch(() => {
      if (inFlight === attempt) inFlight = null;
    });

    return attempt;
  };
}

export type OracleSetupFieldsProps = Readonly<{
  question: string;
  wristCircumferenceMm: number | undefined;
  isSubmitting: boolean;
  error: FrontendErrorCode | null;
  onQuestionChange(value: string): void;
  onWristChange(value: number | undefined): void;
  onSubmit(): void;
}>;

export function OracleSetupFields({
  question,
  wristCircumferenceMm,
  isSubmitting,
  error,
  onQuestionChange,
  onWristChange,
  onSubmit
}: OracleSetupFieldsProps) {
  const wristInvalid =
    wristCircumferenceMm !== undefined &&
    (wristCircumferenceMm < MIN_BRACELET_CIRCUMFERENCE_MM ||
      wristCircumferenceMm > MAX_BRACELET_CIRCUMFERENCE_MM);

  return (
    <form
      className="oracleForm"
      data-oracle-setup-fields="true"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isSubmitting) onSubmit();
      }}
    >
      <div className="oracleField">
        <label className="oracleFieldLabel" htmlFor="oracle-question">
          想问的事（可选问题）
        </label>
        <textarea
          className="oracleInput"
          id="oracle-question"
          maxLength={120}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder="不输入也可以启卦"
          rows={2}
          value={question}
        />
        <p className="oracleFieldHint">问题仅用于本次请求；不会写入浏览器存储、服务端持久化/日志，也不会提供给文案或设计模型。</p>
      </div>

      <div className="oracleField">
        <label className="oracleFieldLabel" htmlFor="oracle-wrist">
          净手围（可选）
        </label>
        <input
          className="oracleInput"
          id="oracle-wrist"
          inputMode="decimal"
          max={MAX_BRACELET_CIRCUMFERENCE_MM / 10}
          min={MIN_BRACELET_CIRCUMFERENCE_MM / 10}
          onChange={(event) => {
            const raw = event.target.value.trim();
            if (raw === "") {
              onWristChange(undefined);
              return;
            }
            const cm = Number(raw);
            onWristChange(Number.isFinite(cm) ? Math.round(cm * 10) : undefined);
          }}
          placeholder={`常见范围 ${formatWristRangeCm()} cm`}
          step="0.1"
          type="number"
          value={wristCircumferenceMm === undefined ? "" : String(wristCircumferenceMm / 10)}
        />
        <p className="oracleFieldHint" data-oracle-wrist-hint="true">
          常见建议范围 {formatWristRangeCm()} cm（{MIN_BRACELET_CIRCUMFERENCE_MM}–{MAX_BRACELET_CIRCUMFERENCE_MM} mm），用于推荐尺寸参考。
        </p>
        {wristInvalid ? (
          <p className="oracleInlineError" role="alert">
            腕围请填写 {formatWristRangeCm()} cm。
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="oracleInlineError" role="alert">
          {error}
        </p>
      ) : null}

      <button className="oraclePrimaryAction" disabled={isSubmitting} type="submit">
        {isSubmitting ? "正在启卦…" : "启卦"}
      </button>
    </form>
  );
}

export type OracleSetupProps = OracleSetupFieldsProps;

export function OracleSetup(props: OracleSetupProps) {
  return (
    <main className="oraclePage" data-oracle-setup="true" data-star-surface="oracle-setup">
      <div className="oracleShell">
        <header className="oracleHero">
          <p className="oracleEyebrow">玄圭星台</p>
          <h1 className="oracleTitle">星台问卦</h1>
          <p className="oracleLede">凝神一问，星台将以六爻为你生成一组水晶设计线索。</p>
        </header>

        <OracleSetupFields {...props} />

        <details className="oracleDisclosure">
          <summary>查看说明（文化 · 算法 · 隐私）</summary>
          <div className="oracleDisclosurePanel">
            <p>三钱法一次完成六爻，结果用于自我观察与设计灵感，不代表确定命运。</p>
            <p>随机数在服务端生成；页面动画只呈现已有结果，不参与算法。</p>
            <p>可选问题仅用于本次请求；不会写入浏览器存储、服务端持久化/日志，也不会提供给文案或设计模型。刷新后问题不会从服务器恢复。</p>
            <p className="oracleNotice">内容仅作文化观察与设计灵感，不构成预测、医疗建议或水晶功效承诺。</p>
          </div>
        </details>
      </div>
    </main>
  );
}
