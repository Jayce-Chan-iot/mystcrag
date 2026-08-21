"use client";

import type {
  CreateTarotSessionRequest,
  TarotSpreadType,
  TarotTheme
} from "@mystcrag/design-contract";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { ERROR_PRESENTATION, toFrontendApiError } from "../../../lib/api/frontend-api-error";
import { tarotApi, type TarotApiClient } from "../../../lib/api/tarot-api";
import {
  useTarotQuestionDraftStore,
  type TarotQuestionDraftStore
} from "./tarot-question-draft-provider";

export const TAROT_THEMES: ReadonlyArray<Readonly<{ value: TarotTheme; label: string; detail: string }>> = [
  { value: "RELATIONSHIPS", label: "关系与相处", detail: "梳理关系中的感受、界限与相互理解。" },
  { value: "CAREER", label: "事业与方向", detail: "观察工作节奏、选择与正在形成的方向。" },
  { value: "SELF_GROWTH", label: "自我成长", detail: "回到内在，辨认当下想培养的力量。" },
  { value: "NEW_BEGINNINGS", label: "新的开始", detail: "为转变与启程寻找更清晰的色彩线索。" },
  { value: "FINANCIAL_PLANNING", label: "财务规划", detail: "以克制、非预测的方式整理规划心态。" }
];

export type TarotSetupInput = Readonly<{
  spreadType: TarotSpreadType;
  theme: TarotTheme;
  question: string;
  saveQuestion: boolean;
  parentSessionId?: string;
}>;

type CreateSession = (
  request: CreateTarotSessionRequest
) => Promise<{ session: { sessionId: string } }>;

type TarotSetupSubmitterDependencies = Readonly<{
  create: CreateSession;
  draftStore: TarotQuestionDraftStore;
  navigate(path: string): void;
  requestId(): string;
}>;

export function createTarotSetupSubmitter({
  create,
  draftStore,
  navigate,
  requestId
}: TarotSetupSubmitterDependencies): (input: TarotSetupInput) => Promise<void> {
  let inFlight: Promise<void> | null = null;

  return (input) => {
    if (inFlight !== null) return inFlight;

    const question = input.question.trim();
    if (question.length > 120) return Promise.reject(new Error("问题最多 120 个字符。"));
    if (input.saveQuestion && question.length === 0) {
      return Promise.reject(new Error("勾选保存问题前，请先输入问题。"));
    }

    const request: CreateTarotSessionRequest = {
      requestId: requestId(),
      spreadType: input.spreadType,
      theme: input.theme,
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {})
    };

    inFlight = (async () => {
      const response = await create(request);
      draftStore.set(response.session.sessionId, {
        question,
        saveQuestion: input.saveQuestion && question.length > 0
      });
      navigate(`/tarot/draw/${encodeURIComponent(response.session.sessionId)}`);
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  };
}

export type TarotSetupFieldsProps = Readonly<{
  theme: TarotTheme;
  spreadType: TarotSpreadType;
  question: string;
  saveQuestion: boolean;
  error: string | null;
  isSubmitting: boolean;
  onThemeChange(value: TarotTheme): void;
  onSpreadChange(value: TarotSpreadType): void;
  onQuestionChange(value: string): void;
  onSaveQuestionChange(value: boolean): void;
  onSubmit(): void;
}>;

export function TarotSetupFields({
  theme,
  spreadType,
  question,
  saveQuestion,
  error,
  isSubmitting,
  onThemeChange,
  onSpreadChange,
  onQuestionChange,
  onSaveQuestionChange,
  onSubmit
}: TarotSetupFieldsProps) {
  const questionHelpId = "tarot-question-help";

  return (
    <form
      className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,.72fr)]"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <section className="rounded-[2rem] border border-[var(--border)] bg-white/70 p-5 shadow-[0_24px_70px_rgb(62_47_72/0.07)] sm:p-8" aria-labelledby="tarot-theme-title">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">01 · Reading theme</p>
        <h2 className="mt-4 font-serif text-3xl" id="tarot-theme-title">此刻，你想把注意力放在哪里？</h2>
        <label className="mt-8 block text-sm font-medium" htmlFor="tarot-theme">选择主题</label>
        <select
          className="mt-3 min-h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 outline-none transition focus:border-[var(--accent)]"
          id="tarot-theme"
          onChange={(event) => onThemeChange(event.target.value as TarotTheme)}
          value={theme}
        >
          {TAROT_THEMES.map((option) => (
            <option key={option.value} value={option.value}>{option.label} · {option.detail}</option>
          ))}
        </select>

        <label className="mt-8 block text-sm font-medium" htmlFor="tarot-question">想问的问题（可选）</label>
        <textarea
          aria-describedby={questionHelpId}
          className="mt-3 min-h-32 w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 leading-7 outline-none transition focus:border-[var(--accent)]"
          id="tarot-question"
          maxLength={120}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder="例如：我该如何整理接下来的方向？"
          value={question}
        />
        <div className="mt-2 flex items-start justify-between gap-4 text-xs leading-5 text-[var(--muted)]" id={questionHelpId}>
          <span>默认情况下，问题不会被保存；仅在本次塔罗流程的内存中使用。</span>
          <span className="shrink-0" aria-live="polite">{question.length} / 120</span>
        </div>
        <label className="mt-5 flex min-h-11 items-start gap-3 rounded-2xl bg-[var(--surface-soft)]/70 p-4 text-sm leading-6">
          <input
            checked={saveQuestion}
            className="mt-1"
            disabled={question.trim().length === 0}
            onChange={(event) => onSaveQuestionChange(event.target.checked)}
            type="checkbox"
          />
          <span>经我明确同意，加密保存这个问题，方便之后回看本次设计。</span>
        </label>
      </section>

      <section className="flex flex-col rounded-[2rem] border border-[var(--border)] bg-[var(--surface)]/80 p-5 sm:p-8" aria-labelledby="tarot-spread-title">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">02 · Card spread</p>
        <h2 className="mt-4 font-serif text-3xl" id="tarot-spread-title">选择抽牌方式</h2>
        <fieldset className="mt-7 grid gap-3">
          <legend className="sr-only">牌阵</legend>
          {[
            { value: "SINGLE" as const, label: "单张指引", detail: "用一张牌聚焦此刻最值得留意的线索。" },
            { value: "PAST_PRESENT_FUTURE" as const, label: "三张牌阵", detail: "从过去、现在与未来三个角度整理感受。" }
          ].map((option) => (
            <label className={`flex min-h-24 cursor-pointer items-start gap-4 rounded-2xl border p-4 transition ${spreadType === option.value ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-white/55"}`} key={option.value}>
              <input
                checked={spreadType === option.value}
                className="mt-1"
                name="tarot-spread"
                onChange={() => onSpreadChange(option.value)}
                type="radio"
                value={option.value}
              />
              <span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{option.detail}</span></span>
            </label>
          ))}
        </fieldset>

        <div className="mt-7 rounded-2xl border border-[var(--border)] bg-white/55 p-4 text-xs leading-6 text-[var(--muted)]">
          塔罗内容仅用于自我反思与设计灵感，不构成事实预测、医疗或投资建议；水晶搭配也不代表功效承诺。
        </div>
        {error ? <p className="mt-5 text-sm leading-6 text-[var(--danger)]" role="alert">{error}</p> : null}
        <button
          className="mt-7 min-h-13 rounded-full bg-[var(--accent-deep)] px-7 text-sm font-medium text-white shadow-[0_14px_35px_rgb(73_53_95/0.22)] transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-55 lg:mt-auto"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "正在准备牌阵…" : "进入抽牌"} <span aria-hidden="true">→</span>
        </button>
      </section>
    </form>
  );
}

export function TarotSetup({ client = tarotApi }: Readonly<{ client?: Pick<TarotApiClient, "create"> }>) {
  const router = useRouter();
  const draftStore = useTarotQuestionDraftStore();
  const [theme, setTheme] = useState<TarotTheme>("SELF_GROWTH");
  const [spreadType, setSpreadType] = useState<TarotSpreadType>("PAST_PRESENT_FUTURE");
  const [question, setQuestion] = useState("");
  const [saveQuestion, setSaveQuestion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitterRef = useRef<ReturnType<typeof createTarotSetupSubmitter> | null>(null);

  if (submitterRef.current === null) {
    submitterRef.current = createTarotSetupSubmitter({
      create: (request) => client.create(request),
      draftStore,
      navigate: (path) => router.push(path),
      requestId: () => crypto.randomUUID()
    });
  }

  const submit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await submitterRef.current?.({ theme, spreadType, question, saveQuestion });
    } catch (submissionError) {
      const presentation = ERROR_PRESENTATION[toFrontendApiError(submissionError).code];
      setError(`${presentation.title}：${presentation.message}`);
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-5rem)] px-5 pb-20 pt-10 sm:px-8 sm:pb-28 sm:pt-14">
      <header className="mx-auto mb-10 max-w-3xl text-center sm:mb-14">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--accent)]">塔罗水晶引导 · Tarot guidance</p>
        <h1 className="mt-5 font-serif text-4xl leading-tight sm:text-6xl">先听见问题，再选择一组牌。</h1>
        <p className="mx-auto mt-5 max-w-2xl leading-8 text-[var(--muted)]">主题与问题帮助我们理解你想探索的方向；牌面只提供反思与配色灵感，最终选择仍由你决定。</p>
      </header>
      <TarotSetupFields
        error={error}
        isSubmitting={isSubmitting}
        onQuestionChange={(value) => {
          setQuestion(value);
          if (value.trim().length === 0) setSaveQuestion(false);
          setError(null);
        }}
        onSaveQuestionChange={setSaveQuestion}
        onSpreadChange={setSpreadType}
        onSubmit={() => void submit()}
        onThemeChange={setTheme}
        question={question}
        saveQuestion={saveQuestion}
        spreadType={spreadType}
        theme={theme}
      />
    </main>
  );
}
