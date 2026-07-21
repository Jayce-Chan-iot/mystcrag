import type { DisclaimerKey, PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";

const statusCopy = {
  PASSED: "设计文案已通过合规检查",
  PENDING: "设计文案正在检查中",
  FLAGGED: "设计文案需要人工确认",
  REJECTED: "此设计暂不可发布或下单"
} as const;

const disclaimerCopy = {
  CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT: "文化意象仅作为设计灵感，不代表科学功效。",
  DESIGN_INSPIRATION_ONLY: "相关内容仅用于审美表达与设计灵感。"
} as const satisfies Record<DisclaimerKey, string>;

export function ComplianceNotice({ design }: { design: PublicDesignV1 }) {
  const status = design.compliance.complianceStatus;

  return (
    <aside aria-label="合规说明" className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 text-sm leading-6 text-[var(--muted)]" data-compliance-status={status}>
      <p className="font-medium text-[var(--foreground)]">{statusCopy[status]}</p>
      {design.compliance.disclaimerKeys.map((key) => (
        <small className="mt-1 block" key={key}>{disclaimerCopy[key]}</small>
      ))}
    </aside>
  );
}
