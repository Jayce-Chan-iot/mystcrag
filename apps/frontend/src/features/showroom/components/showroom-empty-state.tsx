import {
  SystemState,
  type SystemStateAction
} from "../../../../components/page-scaffold";

/**
 * TASK-COMMERCE-FE-VISUAL-001 — the honest showroom empty state.
 *
 * Until Task 7A delivers approved 无野 photography and Task 7B delivers reviewed
 * three-locale copy with human-confirmed prices, no showroom slot may be filled.
 * This component publishes that fact through the shared `SystemState` primitive:
 * it never renders a product card, an image, a price, a stock line, a disabled
 * purchase control, or any other hint that a transaction is one step away.
 *
 * The `reason` names *why* nothing is shown so the page can be measured and audited;
 * the wording is display copy handed in by the caller from the reviewed
 * zh-CN / zh-TW / en-US message tables. This component owns no text of its own and
 * does not introduce a second language mechanism.
 */

export type ShowroomEmptyReason =
  | "content_pending"
  | "license_pending"
  | "media_pending"
  | "no_products"
  | "region_unavailable";

/** Reviewed display wording supplied by the caller. */
export type ShowroomEmptyCopy = { message: string; title: string };

export type ShowroomEmptyStateProps = {
  /** The caller's single real next step. Without it the state shows no control at all. */
  action?: SystemStateAction;
  copy: ShowroomEmptyCopy;
  reason: ShowroomEmptyReason;
};

export function ShowroomEmptyState({ action, copy, reason }: ShowroomEmptyStateProps) {
  return (
    <div
      className="showroom-empty-stage"
      data-showroom-empty-stage="true"
      data-star-surface="system-state"
    >
      <SystemState
        action={action}
        className="showroom-empty-state"
        data-showroom-empty-state={reason}
        kind="empty"
        message={copy.message}
        title={copy.title}
      />
    </div>
  );
}
