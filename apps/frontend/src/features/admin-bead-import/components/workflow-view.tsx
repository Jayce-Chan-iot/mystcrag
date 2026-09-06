import * as React from "react";
import type { ReactNode } from "react";

import {
  WORKFLOW_STEP_LABELS,
  WORKFLOW_STEPS,
  isWorkflowStepReachable,
  workflowStepIndex,
  type WorkflowStep
} from "../workflow-model";
import type { BeadImportWorkflowState } from "../workflow-state";
import { NOTICE_CLASS, NOTICE_TONE_CLASS } from "./control-styles";

/**
 * Presentational shell for a single import session. It owns the four-step
 * stepper and the global notices; each step's panel is passed in by the
 * container, so this file never decides what a step means. A step is reachable
 * only when the Backend session can actually support it, so the operator can
 * revisit earlier work but never jump ahead of what the server has produced.
 */

export type WorkflowViewProps = {
  state: BeadImportWorkflowState;
  step: WorkflowStep;
  onSelectStep: (step: WorkflowStep) => void;
  children: ReactNode;
};

function StepLink({
  step,
  index,
  current,
  reachable,
  onSelect
}: {
  step: WorkflowStep;
  index: number;
  current: boolean;
  reachable: boolean;
  onSelect: (step: WorkflowStep) => void;
}) {
  const label = WORKFLOW_STEP_LABELS[step];
  const state = current ? "current" : reachable ? "reachable" : "locked";

  return (
    <li className="min-w-0 flex-1" aria-current={current ? "step" : undefined}>
      <button
        type="button"
        onClick={() => onSelect(step)}
        disabled={!reachable || current}
        aria-label={`第 ${index + 1} 步：${label.title}`}
        className={`flex min-w-0 flex-col items-start gap-1 rounded-lg border p-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          current
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : reachable
              ? "border-[var(--border)] hover:border-[var(--accent)]"
              : "border-[var(--border)] opacity-60"
        }`}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          第 {index + 1} 步
        </span>
        <span className="min-w-0 text-sm font-medium">{label.title}</span>
        <span className="min-w-0 text-xs leading-4 text-[var(--muted)]">{state === "locked" ? "尚不可用" : label.hint}</span>
      </button>
    </li>
  );
}

export function WorkflowView({ state, step, onSelectStep, children }: WorkflowViewProps) {
  const currentIndex = workflowStepIndex(step);

  return (
    <section aria-labelledby="bead-import-workflow-heading" className="flex min-w-0 flex-col gap-6">
      <header className="min-w-0">
        <h2 id="bead-import-workflow-heading" className="text-lg font-semibold tracking-tight">
          {WORKFLOW_STEP_LABELS[step].title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{WORKFLOW_STEP_LABELS[step].hint}</p>
      </header>

      <ol
        aria-label="导入步骤"
        className="flex min-w-0 flex-col gap-2 sm:flex-row"
      >
        {WORKFLOW_STEPS.map((candidate, index) => (
          <StepLink
            key={candidate}
            step={candidate}
            index={index}
            current={candidate === step}
            reachable={
              state.session !== null &&
              isWorkflowStepReachable(state.session, candidate) &&
              workflowStepIndex(candidate) <= currentIndex + 1
            }
            onSelect={onSelectStep}
          />
        ))}
      </ol>

      {state.notices.length > 0 && (
        <div aria-live="polite" className="flex min-w-0 flex-col gap-2">
          {state.notices.map((notice) => (
            <p
              key={notice.id}
              id={notice.id}
              role={notice.tone === "danger" ? "alert" : "status"}
              className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS[notice.tone]} min-w-0 break-all`}
            >
              {notice.message}
            </p>
          ))}
        </div>
      )}

      {children}
    </section>
  );
}
