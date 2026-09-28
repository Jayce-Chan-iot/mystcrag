import * as React from "react";

import type { BraceletFit } from "../model/bracelet-fit";

export type WearFitSummaryProps = {
  compact?: boolean;
  fit: BraceletFit;
};

function formatCm(valueMm: number): string {
  return `${(valueMm / 10).toFixed(1)} cm`;
}

function fitStatusText(status: BraceletFit["status"]): string {
  if (status === "TOO_SMALL") return "偏小";
  if (status === "TOO_LARGE") return "偏大";
  return "常见范围内";
}

export function WearFitSummary({ compact = false, fit }: WearFitSummaryProps) {
  const measurements = [
    { label: "腕围", valueMm: fit.userWristCircumferenceMm },
    { label: "目标内周长", valueMm: fit.targetInnerCircumferenceMm },
    { label: "当前材料路径", valueMm: fit.assembledMaterialPathMm },
    { label: "结构余量", valueMm: fit.elasticAllowanceMm },
    { label: "距目标", valueMm: fit.deltaFromTargetMm }
  ];

  return (
    <section
      aria-label="佩戴合身摘要"
      className={compact ? "flex shrink-0 items-center gap-4 whitespace-nowrap" : "mt-3 space-y-2"}
      data-wear-fit-status={fit.status}
      data-wear-fit-summary="true"
    >
      <dl className={compact ? "flex shrink-0 items-center gap-4" : "grid grid-cols-2 gap-x-4 gap-y-2"}>
        {measurements.map((measurement) => (
          <div
            className={compact ? "flex shrink-0 items-center gap-1" : "flex items-baseline justify-between gap-2"}
            key={measurement.label}
          >
            <dt className="text-xs text-[var(--muted)]">{measurement.label}</dt>
            <dd className={compact ? "font-medium text-[var(--foreground)]" : "text-sm font-medium text-[var(--foreground)]"}>
              {formatCm(measurement.valueMm)}
            </dd>
          </div>
        ))}
      </dl>
      <p className={compact ? "shrink-0 text-xs text-[var(--muted)]" : "text-xs text-[var(--muted)]"}>
        {fitStatusText(fit.status)}
      </p>
      {fit.message ? (
        <p className={compact ? "shrink-0 text-xs text-[var(--muted)]" : "text-xs text-[var(--muted)]"} role="status">
          {fit.message}
        </p>
      ) : null}
      <details className={compact ? "shrink-0 whitespace-normal text-xs text-[var(--muted)]" : "text-xs text-[var(--muted)]"}>
        <summary className="cursor-pointer">尺寸与测量说明</summary>
        <p className="mt-1 leading-5">
          腕围为实测手腕周长；目标内周长是设计目标；当前材料路径是珠子与直通配饰沿绳长度之和；结构余量为弹性余量；距目标为目标内周长与当前材料路径之差。
        </p>
      </details>
    </section>
  );
}
