"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FlowNotice } from "../../../components/flow-notice";
import { designApi } from "../../../lib/api/design-api";
import { saveDesignBudgetContext } from "../../../lib/api/design-session";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import {
  INITIAL_ANSWERS,
  getNextStepIndex,
  getPreviousStepIndex,
  QUESTIONNAIRE_STEPS,
  QUESTION_OPTIONS,
  toGenerateDesignRequest,
  validateQuestionnaireStep,
  type QuestionnaireAnswers
} from "../model/questionnaire";

export function QuestionnaireWizard() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(INITIAL_ANSWERS);
  const [error, setError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<FrontendErrorCode | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const step = QUESTIONNAIRE_STEPS[stepIndex] ?? QUESTIONNAIRE_STEPS[0]!;
  const progress = ((stepIndex + 1) / QUESTIONNAIRE_STEPS.length) * 100;

  const updateAnswer = (value: string) => {
    setAnswers((current) => ({ ...current, [step.id]: value }));
    setError(null);
  };

  const moveNext = async () => {
    const validationError = validateQuestionnaireStep(step.id, answers);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (stepIndex < QUESTIONNAIRE_STEPS.length - 1) {
      setStepIndex((current) => getNextStepIndex(current));
      setError(null);
      return;
    }

    setIsSubmitting(true);
    setApiError(null);
    try {
      const request = toGenerateDesignRequest(answers);
      const response = await designApi.generate(request);
      saveDesignBudgetContext(response.design.designId, request);
      router.push(`/design/${encodeURIComponent(response.design.designId)}`);
    } catch (generationError) {
      setApiError(toFrontendApiError(generationError).code === "NETWORK_ERROR" ? "AI_GENERATION_FAILED" : toFrontendApiError(generationError).code);
      setIsSubmitting(false);
    }
  };

  const options = step.id === "wrist" ? null : QUESTION_OPTIONS[step.id];

  return (
    <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col px-5 pb-28 pt-8 sm:px-8 sm:pb-16 sm:pt-12">
      <div className="flex items-center justify-between text-xs tracking-[0.15em] text-[var(--muted)]">
        <span>AI DESIGN · PERSONAL BRIEF</span>
        <span aria-label={`第 ${stepIndex + 1} 步，共 ${QUESTIONNAIRE_STEPS.length} 步`}>{String(stepIndex + 1).padStart(2, "0")} / 06</span>
      </div>
      <div className="mt-5 h-px overflow-hidden bg-[var(--border)]" role="progressbar" aria-valuemin={1} aria-valuemax={6} aria-valuenow={stepIndex + 1}>
        <div className="h-full bg-[var(--accent)] transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <section className="animate-reveal-softly mx-auto mt-14 w-full max-w-3xl" key={step.id} aria-labelledby="question-title">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">{step.eyebrow}</p>
        <h1 className="mt-5 font-serif text-3xl leading-tight sm:text-5xl" id="question-title">{step.title}</h1>
        <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">{step.description}</p>

        {step.id === "wrist" ? (
          <div className="mt-12 max-w-md">
            <label className="block text-sm text-[var(--muted)]" htmlFor="wrist">净手围（毫米）</label>
            <div className="mt-3 flex items-end border-b border-[var(--foreground)] pb-3">
              <input
                aria-describedby={error ? "question-error" : "wrist-help"}
                aria-invalid={Boolean(error)}
                className="min-w-0 flex-1 bg-transparent font-serif text-5xl outline-none placeholder:text-[var(--border)]"
                id="wrist"
                inputMode="decimal"
                max="220"
                min="120"
                onChange={(event) => updateAnswer(event.target.value)}
                placeholder="155"
                type="number"
                value={answers.wrist}
              />
              <span className="pb-1 text-[var(--muted)]">mm</span>
            </div>
            <p className="mt-3 text-sm text-[var(--muted)]" id="wrist-help">常见成人手围约为 140–180 mm。</p>
          </div>
        ) : (
          <fieldset className="mt-10 grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">{step.title}</legend>
            {options?.map((option) => {
              const selected = answers[step.id] === option.value;
              return (
                <label className={`cursor-pointer rounded-2xl border p-5 transition duration-300 ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_12px_30px_rgb(77_55_96/0.08)]" : "border-[var(--border)] bg-white/50 hover:border-[var(--accent)]/55"}`} key={option.value}>
                  <input className="sr-only" checked={selected} name={step.id} onChange={() => updateAnswer(option.value)} type="radio" value={option.value} />
                  <span className="flex items-start justify-between gap-4">
                    <span><span className="block font-medium">{option.label}</span><span className="mt-2 block text-sm leading-6 text-[var(--muted)]">{option.detail}</span></span>
                    {option.swatches ? <span className="flex pt-1">{option.swatches.map((color) => <span className="-ml-1 h-5 w-5 rounded-full border border-white" key={color} style={{ background: color }} />)}</span> : <span aria-hidden="true" className={`mt-1 h-4 w-4 rounded-full border ${selected ? "border-[var(--accent)] bg-[var(--accent)] shadow-[inset_0_0_0_3px_var(--accent-soft)]" : "border-[var(--border)]"}`} />}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        {error ? <p className="mt-5 text-sm text-[var(--danger)]" id="question-error" role="alert">{error}</p> : null}
        {apiError ? <div className="mt-6"><FlowNotice code={apiError} compact onAction={() => void moveNext()} /></div> : null}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/94 px-5 py-4 backdrop-blur sm:static sm:mt-auto sm:border-0 sm:bg-transparent sm:px-0 sm:pt-14">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <button className="min-w-24 rounded-full px-5 py-3 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-30" disabled={stepIndex === 0 || isSubmitting} onClick={() => { setStepIndex((current) => getPreviousStepIndex(current)); setError(null); }} type="button">← 上一步</button>
          <button className="min-w-36 rounded-full bg-[var(--foreground)] px-6 py-3 text-sm text-white transition hover:bg-[var(--accent-deep)] disabled:cursor-wait disabled:opacity-60" disabled={isSubmitting} onClick={() => void moveNext()} type="button">
            {isSubmitting ? "正在生成…" : stepIndex === QUESTIONNAIRE_STEPS.length - 1 ? "生成设计" : "继续 →"}
          </button>
        </div>
      </div>
    </main>
  );
}
