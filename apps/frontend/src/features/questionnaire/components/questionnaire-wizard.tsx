"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FlowNotice } from "../../../components/flow-notice";
import { designApi } from "../../../lib/api/design-api";
import { saveGeneratedDesignOptions } from "../../../lib/api/design-session";
import { toFrontendApiError, type FrontendErrorCode } from "../../../lib/api/frontend-api-error";
import {
  INITIAL_ANSWERS,
  getNextStepIndex,
  getPreviousStepIndex,
  QUESTIONNAIRE_STEPS,
  QUESTION_OPTIONS,
  toRecommendDesignRequest,
  validateQuestionnaireStep,
  type QuestionnaireAnswers
} from "../model/questionnaire";
import { WristMeasurementGuide } from "./wrist-measurement-guide";

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

  const toggleExcludedProduct = (productId: string) => {
    setAnswers((current) => ({
      ...current,
      excludedProductIds: current.excludedProductIds.includes(productId)
        ? current.excludedProductIds.filter((id) => id !== productId)
        : [...current.excludedProductIds, productId]
    }));
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
      const request = toRecommendDesignRequest(answers);
      const response = await designApi.recommend(request);
      if (response.candidates.length === 0) {
        throw new Error("Backend did not return a design option.");
      }
      const designIds = response.candidates.map((candidate) => candidate.designId);
      const routeDesignId = designIds[0];
      if (!routeDesignId) throw new Error("Backend did not return a design option.");
      saveGeneratedDesignOptions(routeDesignId, designIds, request);
      router.push(`/design/${encodeURIComponent(routeDesignId)}`);
    } catch (generationError) {
      setApiError(toFrontendApiError(generationError).code === "NETWORK_ERROR" ? "AI_GENERATION_FAILED" : toFrontendApiError(generationError).code);
      setIsSubmitting(false);
    }
  };

  const options = step.id === "wrist" ? null : QUESTION_OPTIONS[step.id];

  return (
    <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col px-5 pb-28 pt-8 sm:px-8 sm:pb-16 sm:pt-12" data-atelier-surface="questionnaire">
      <div className="flex items-center justify-between text-xs tracking-[0.15em] text-[var(--muted)]">
        <span>AI DESIGN · PERSONAL BRIEF</span>
        <span aria-label={`第 ${stepIndex + 1} 步，共 ${QUESTIONNAIRE_STEPS.length} 步`}>{String(stepIndex + 1).padStart(2, "0")} / 06</span>
      </div>
      <ol className="mt-4 grid grid-cols-6 gap-2" aria-label="AI 设计问卷进度" data-questionnaire-stepper="true">
        {QUESTIONNAIRE_STEPS.map((questionnaireStep, index) => (
          <li className="min-w-0 text-center" data-active={index === stepIndex || undefined} data-complete={index < stepIndex || undefined} key={questionnaireStep.id}>
            <span className={`mx-auto grid h-7 w-7 place-items-center rounded-full border text-[0.68rem] ${index <= stepIndex ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white" : "border-[var(--border)] bg-white text-[var(--muted)]"}`}>{index + 1}</span>
            <span className="mt-1 hidden truncate text-[0.62rem] text-[var(--muted)] sm:block">{questionnaireStep.eyebrow.replace(/^\d+\s*\u00b7\s*/, "")}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 h-px overflow-hidden bg-[var(--border)]" role="progressbar" aria-valuemin={1} aria-valuemax={6} aria-valuenow={stepIndex + 1}>
        <div className="h-full bg-[var(--accent)] transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <section className="mx-auto mt-14 w-full max-w-3xl sm:animate-reveal-softly" key={step.id} aria-labelledby="question-title">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">{step.eyebrow}</p>
        <h1 className="mt-5 font-serif text-3xl leading-tight sm:text-5xl" id="question-title">{step.title}</h1>
        <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">{step.description}</p>

        {step.id === "wrist" ? (
          <div className="mt-10 grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
            <div className="max-w-md">
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
            <WristMeasurementGuide />
          </div>
        ) : (
          <><fieldset className="mt-10 grid gap-3 sm:grid-cols-2" role="radiogroup">
            <legend className="sr-only">{step.title}</legend>
            {options?.map((option) => {
              const selected = answers[step.id] === option.value;
              return (
                <button
                  aria-checked={selected}
                  className={`touch-manipulation rounded-2xl border p-5 text-left transition duration-300 ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_12px_30px_rgb(77_55_96/0.08)]" : "border-[var(--border)] bg-white/50 hover:border-[var(--accent)]/55"}`}
                  key={option.value}
                  onClick={() => updateAnswer(option.value)}
                  role="radio"
                  type="button"
                >
                  <span className="flex items-start justify-between gap-4">
                    <span><span className="block font-medium">{option.label}</span><span className="mt-2 block text-sm leading-6 text-[var(--muted)]">{option.detail}</span></span>
                    {option.swatches ? <span className="flex pt-1">{option.swatches.map((color) => <span className="-ml-1 h-5 w-5 rounded-full border border-white" key={color} style={{ background: color }} />)}</span> : <span aria-hidden="true" className={`mt-1 h-4 w-4 rounded-full border ${selected ? "border-[var(--accent)] bg-[var(--accent)] shadow-[inset_0_0_0_3px_var(--accent-soft)]" : "border-[var(--border)]"}`} />}
                  </span>
                </button>
              );
            })}
          </fieldset>
          {step.id === "culture" ? (
            <div className="mt-8 grid gap-5 rounded-2xl border border-[var(--border)] bg-white/50 p-5">
              <fieldset>
                <legend className="font-medium">不想出现的材料（可选）</legend>
                <p className="mt-1 text-sm text-[var(--muted)]">排除项会随三套方案一起送到 Backend，并在目录筛选前生效。</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {[["product-aquamarine-round-8", "海蓝宝"], ["product-moonstone-round-6", "月光石"], ["product-quartz-round-10", "白水晶"]].map(([id, label]) => <label className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2" key={id}><input checked={answers.excludedProductIds.includes(id!)} onChange={() => toggleExcludedProduct(id!)} type="checkbox" />{label}</label>)}
                </div>
              </fieldset>
              <label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input checked={answers.personalizationConsent} className="mt-1" onChange={(event) => setAnswers((current) => ({ ...current, personalizationConsent: event.target.checked }))} type="checkbox" /><span>同意仅将本次偏好用于生成与保存这三套设计；不用于公开展示。发布仍会单独征求授权。</span></label>
            </div>
          ) : null}</>
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
