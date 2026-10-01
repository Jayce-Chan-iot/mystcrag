import type { CommunityV1, DesignMode, PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";

const designModeLabels: Record<DesignMode, string> = {
  AI_GENERATED: "AI 生成",
  DIY_CREATED: "DIY 创作",
  AI_ASSISTED: "AI 辅助",
  TEMPLATE_REMIX: "模板改写",
  TAROT_GUIDED: "塔罗灵感",
  ORACLE_GUIDED: "星台问卦"
};

// `Visibility` has no standalone type export in Design Contract; the community
// projection carries the only authoritative union.
const visibilityLabels: Record<CommunityV1["visibility"], string> = {
  PRIVATE: "Private（仅自己可见）",
  UNLISTED: "Unlisted（凭链接可见）",
  PUBLIC: "Public（已进入列表）"
};

export function formatDesignUtcMinute(isoDateTime: string): string {
  const parsed = new Date(isoDateTime);
  if (Number.isNaN(parsed.getTime())) return "时间不可确认";
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}` +
    ` ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())} UTC`
  );
}

export function DesignSummary({ design }: { design: PublicDesignV1 }) {
  const facts = [
    { label: "设计编号", value: design.designId },
    { label: "来源", value: designModeLabels[design.designMode] },
    { label: "当前版本", value: `v${design.revision}` },
    { label: "更新时间", value: formatDesignUtcMinute(design.updatedAt) },
    { label: "可见性", value: visibilityLabels[design.community.visibility] }
  ];

  return (
    <section aria-labelledby="design-summary-heading" data-star-design-summary="true">
      <h2 id="design-summary-heading">{design.designName}</h2>
      <p>{design.story.designStory}</p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-design-summary-facts="true">
        {facts.map((fact) => (
          <div className="flex items-baseline justify-between gap-3" data-design-summary-fact={fact.label} key={fact.label}>
            <dt className="text-xs text-[var(--muted)]">{fact.label}</dt>
            <dd className="break-all text-right text-sm text-[var(--foreground)]" data-status-mark="true">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
