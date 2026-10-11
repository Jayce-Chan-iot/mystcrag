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
 */

export type ShowroomEmptyReason =
  | "content_pending"
  | "license_pending"
  | "media_pending"
  | "no_products"
  | "region_unavailable";

type ShowroomEmptyCopy = { message: string; title: string };

const EMPTY_STATE_COPY = {
  content_pending: {
    title: "本页作品仍在准备中",
    message:
      "简体中文、繁体中文与英文的创作说明尚未完成人工审校，材料规格与署名也仍在核对。缺项期间这里不发布商品资料。"
  },
  license_pending: {
    title: "展示授权仍在确认中",
    message:
      "这些作品的展示授权——可展示区域、期限与允许的使用范围——尚未逐件确认。确认完成之前，本页不公开任何作品资料。"
  },
  media_pending: {
    title: "作品影像尚在准备中",
    message:
      "尚无经核准的无野作品摄影可以展示，因此这里不放替代图片，也不列价格与可获得性。"
  },
  no_products: {
    title: "暂无可展示作品",
    message:
      "玄矶精选正在准备第一批无野作品，本页暂不发布商品，也未开放线上购买。你可以先开始一次自己的创作。"
  },
  region_unavailable: {
    title: "该区域暂不可展示",
    message:
      "当前选择的市场没有经核准可展示的作品。可展示区域与界面语言是分开的两件事，这里不会替你选择市场，也不做任何金额换算。"
  }
} as const satisfies Record<ShowroomEmptyReason, ShowroomEmptyCopy>;

export type ShowroomEmptyStateProps = {
  /** The caller's single real next step. Without it the state shows no control at all. */
  action?: SystemStateAction;
  reason: ShowroomEmptyReason;
};

export function showroomEmptyStateCopy(reason: ShowroomEmptyReason): ShowroomEmptyCopy {
  return EMPTY_STATE_COPY[reason];
}

export function ShowroomEmptyState({ action, reason }: ShowroomEmptyStateProps) {
  const copy = showroomEmptyStateCopy(reason);

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
