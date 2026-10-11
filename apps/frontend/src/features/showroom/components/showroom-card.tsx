import Image from "next/image";

import { StarSurface } from "@mystcrag/ui";

/**
 * TASK-COMMERCE-FE-VISUAL-001 — the curated showroom work card.
 *
 * Presentation only: every line, including the note shown when no approved
 * photography exists yet, is display copy handed in by the caller from the
 * reviewed message tables. The card never fetches, never infers a market from the
 * interface language, never manufactures a price, stock line or destination, and
 * never falls back to wording of its own. A card without a caller destination is
 * not navigable at all.
 */

const CARD_FRAME_SIZES =
  "(max-width: 639px) calc(100vw - 2rem), (max-width: 1279px) calc(50vw - 3rem), calc((100vw - 12rem) / 3)";

export type ShowroomCardVisual = {
  /** Approved product photography source, cleared item by item by the media gate. */
  src: string;
  /** Reviewed alternative text for this exact frame. */
  alt: string;
};

export type ShowroomCardProps = {
  /** Human-reviewed availability note, e.g. a展示 status. Never a purchase promise. */
  availability?: string;
  /** Designer and collection credit line, already composed by the caller. */
  credit: string;
  /** Reviewed material line. */
  material?: string;
  /** Only a destination handed in by the caller; absent means the card is not navigable. */
  href?: string;
  /** Work name. */
  name: string;
  /** Pre-formatted display price. The card never converts, rounds or guesses a currency. */
  price?: string;
  /** Approved display market, passed explicitly so language can never switch it. */
  region?: string;
  visual?: ShowroomCardVisual;
  /**
   * Reviewed note shown when no approved photography exists yet. The wording belongs
   * to the caller's message tables, so the card holds no copy of its own; with
   * neither a frame nor a note to show, the image region is omitted entirely.
   */
  visualPendingLabel?: string;
};

export function ShowroomCard({
  availability,
  credit,
  material,
  href,
  name,
  price,
  region,
  visual,
  visualPendingLabel
}: ShowroomCardProps) {
  const content = (
    <>
      {visual || visualPendingLabel ? (
        <div
          className="showroom-card__frame"
          data-showroom-card-frame="true"
          data-showroom-visual={visual ? "ready" : "pending"}
        >
          {visual ? (
            <Image
              alt={visual.alt}
              fill
              sizes={CARD_FRAME_SIZES}
              src={visual.src}
            />
          ) : (
            <p
              className="showroom-card__visual-note"
              data-showroom-visual-note="true"
            >
              {visualPendingLabel}
            </p>
          )}
        </div>
      ) : null}
      <div className="showroom-card__body" data-showroom-card-body="true">
        <h3 className="showroom-card__name" data-showroom-card-slot="name">
          {name}
        </h3>
        <p className="showroom-card__credit" data-showroom-card-slot="credit">
          {credit}
        </p>
        {material ? (
          <p className="showroom-card__material" data-showroom-card-slot="material">
            {material}
          </p>
        ) : null}
        {price || region ? (
          <p className="showroom-card__price" data-showroom-card-slot="price">
            {price ? (
              <span data-showroom-card-price="true">{price}</span>
            ) : null}
            {region ? (
              <span className="showroom-card__market" data-showroom-card-market="true">
                {region}
              </span>
            ) : null}
          </p>
        ) : null}
        {availability ? (
          <p className="showroom-card__availability" data-showroom-card-slot="availability">
            {availability}
          </p>
        ) : null}
      </div>
    </>
  );

  return (
    <StarSurface className="showroom-card" data-showroom-card="true" tone="paper">
      {href ? (
        <a aria-label={name} className="showroom-card__link" data-showroom-card-link="true" href={href}>
          {content}
        </a>
      ) : (
        content
      )}
    </StarSurface>
  );
}
