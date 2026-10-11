import type { ReactNode } from "react";
import { useId } from "react";

import Image from "next/image";

import { InstrumentButton, StarSurface } from "@mystcrag/ui";

/**
 * TASK-COMMERCE-FE-VISUAL-001 — the editorial content region.
 *
 * The approved direction (spec §3.1, benchmark §4.4) reads a designer or collection
 * page as an alternating sequence of work imagery, person/craft evidence and short
 * prose — never a stack of same-size cards. This region keeps that order:
 * kicker → section heading → lede → alternating blocks → one next step → work cards.
 *
 * It renders only what the caller passes. It does not fetch, does not invent a
 * designer identity or portrait, and does not wire any storefront route.
 */

const EDITORIAL_FRAME_SIZES =
  "(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) calc(100vw - 6rem), min(46rem, 58vw)";

export type ShowroomEditorialFigureBlock = {
  alt: string;
  caption: string;
  kind: "figure";
  src: string;
};

export type ShowroomEditorialProseBlock = {
  body: string;
  heading?: string;
  kind: "prose";
};

export type ShowroomEditorialBlock = ShowroomEditorialFigureBlock | ShowroomEditorialProseBlock;

export type ShowroomEditorialSectionProps = {
  /** The region's single next step. Omitted means the region offers no control. */
  action?: { href: string; label: string };
  blocks?: readonly ShowroomEditorialBlock[];
  /** Work cards supplied by the caller; rendered after the narrative, never as a block. */
  children?: ReactNode;
  eyebrow?: string;
  lede?: string;
  title: string;
};

export function ShowroomEditorialSection({
  action,
  blocks,
  children,
  eyebrow,
  lede,
  title
}: ShowroomEditorialSectionProps) {
  const headingId = useId();

  return (
    <StarSurface
      aria-labelledby={headingId}
      className="showroom-editorial"
      data-showroom-editorial-section="true"
      tone="ink"
    >
      {eyebrow ? (
        <p className="showroom-editorial__eyebrow" data-showroom-editorial-eyebrow="true">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="showroom-editorial__title" data-showroom-editorial-title="true" id={headingId}>
        {title}
      </h2>
      {lede ? (
        <p className="showroom-editorial__lede" data-showroom-editorial-lede="true">
          {lede}
        </p>
      ) : null}

      {blocks && blocks.length > 0 ? (
        <div className="showroom-editorial__blocks" data-showroom-editorial-blocks="true">
          {blocks.map((block, index) => {
            const blockKey = `${block.kind}-${index}`;
            if (block.kind === "figure") {
              return (
                <figure
                  className="showroom-editorial__figure"
                  data-showroom-editorial-block="figure"
                  key={blockKey}
                >
                  <div
                    className="showroom-editorial__figure-frame"
                    data-showroom-figure-frame="true"
                    data-showroom-visual="ready"
                  >
                    <Image
                      alt={block.alt}
                      fill
                      sizes={EDITORIAL_FRAME_SIZES}
                      src={block.src}
                    />
                  </div>
                  <figcaption className="showroom-editorial__caption" data-showroom-editorial-caption="true">
                    {block.caption}
                  </figcaption>
                </figure>
              );
            }
            return (
              <div
                className="showroom-editorial__prose"
                data-showroom-editorial-block="prose"
                key={blockKey}
              >
                {block.heading ? (
                  <h3 className="showroom-editorial__prose-heading" data-showroom-editorial-prose-heading="true">
                    {block.heading}
                  </h3>
                ) : null}
                <p className="showroom-editorial__prose-body" data-showroom-editorial-prose-body="true">
                  {block.body}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

      {action ? (
        <div className="showroom-editorial__action" data-showroom-editorial-action="true">
          <InstrumentButton
            className="showroom-editorial__action-button"
            href={action.href}
            variant="secondary"
          >
            {action.label}
          </InstrumentButton>
        </div>
      ) : null}

      {children ? (
        <div className="showroom-editorial__works" data-showroom-card-region="true">
          {children}
        </div>
      ) : null}
    </StarSurface>
  );
}
