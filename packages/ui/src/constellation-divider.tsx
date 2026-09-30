import type { HTMLAttributes } from "react";

export type ConstellationDividerProps = HTMLAttributes<HTMLDivElement> & {
  className?: string;
};

/* Decorative instrument divider: armillary ring + star-map ticks + jade-disc center.
 * Geometry vocabulary only — circles, lines, ticks; no glyph labels or ritual marks.
 */
export function ConstellationDivider({ className = "", ...props }: ConstellationDividerProps) {
  return (
    <div
      aria-hidden="true"
      className={className}
      data-star-constellation-divider="true"
      {...props}
    >
      <svg
        fill="none"
        height="16"
        preserveAspectRatio="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1"
        viewBox="0 0 240 16"
        width="240"
      >
        <line x1="8" y1="8" x2="92" y2="8" />
        <circle cx="100" cy="8" r="2.2" />
        <circle cx="120" cy="8" r="6" />
        <circle cx="120" cy="8" r="2.2" />
        <circle cx="140" cy="8" r="2.2" />
        <line x1="148" y1="8" x2="232" y2="8" />
        <polyline points="88,4 92,8 88,12" />
        <polyline points="152,4 148,8 152,12" />
      </svg>
    </div>
  );
}
