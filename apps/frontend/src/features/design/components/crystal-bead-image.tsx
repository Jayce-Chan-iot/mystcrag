import Image from "next/image";
import * as React from "react";

import {
  getBeadVisual,
  nextBeadImagePhase,
  type BeadImagePhase
} from "../model/visual-assets";

/**
 * Renders one bead visual: the backend's approved asset through the same-origin
 * public route when its key is strictly valid, and the static photographic
 * mapping otherwise. An approved image that fails to load switches to the
 * photographic fallback exactly once — a failing fallback never cycles back —
 * and a changed key or material resets the phase. No approved key is ever
 * derived here and no backend origin or credential is involved.
 */
export function CrystalBeadImage({
  materialKey,
  textureAssetKey,
  alt,
  sizes = "64px",
  priority = false
}: {
  materialKey: string;
  textureAssetKey?: string | null;
  alt: string;
  sizes?: string;
  priority?: boolean;
}) {
  const visual = getBeadVisual(materialKey, textureAssetKey);
  const [phase, setPhase] = React.useState<BeadImagePhase>("PRIMARY");
  // Reset without an effect pass: a changed key or material re-enters primary.
  const [phasedFor, setPhasedFor] = React.useState({ materialKey, textureAssetKey });
  if (phasedFor.materialKey !== materialKey || phasedFor.textureAssetKey !== textureAssetKey) {
    setPhasedFor({ materialKey, textureAssetKey });
    setPhase(nextBeadImagePhase(phase, { type: "RESET" }));
  }

  const showApproved = visual.source === "approved" && phase === "PRIMARY";
  const src = showApproved ? visual.src : visual.fallbackSrc;

  return (
    <span
      aria-hidden={alt ? undefined : true}
      className="relative block h-full w-full drop-shadow-[0_7px_6px_rgb(57_45_67/0.18)]"
      data-photo-real-bead="true"
      data-star-workbench-bead="true"
    >
      <Image
        alt={alt}
        className="h-full w-full object-contain"
        height={512}
        fetchPriority={priority ? "high" : "auto"}
        key={src}
        loading="eager"
        onError={() => {
          setPhase((current) => nextBeadImagePhase(current, { type: "ERROR" }));
        }}
        sizes={sizes}
        src={src}
        style={{ filter: visual.filter }}
        width={512}
      />
    </span>
  );
}
