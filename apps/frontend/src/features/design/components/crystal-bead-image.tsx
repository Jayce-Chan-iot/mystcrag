import Image from "next/image";
import * as React from "react";

import { getBeadVisual } from "../model/visual-assets";

export function CrystalBeadImage({
  materialKey,
  alt,
  sizes = "64px",
  priority = false
}: {
  materialKey: string;
  alt: string;
  sizes?: string;
  priority?: boolean;
}) {
  const visual = getBeadVisual(materialKey);
  return (
    <span
      aria-hidden={alt ? undefined : true}
      className="relative block h-full w-full drop-shadow-[0_7px_6px_rgb(57_45_67/0.18)]"
      data-photo-real-bead="true"
    >
      <Image
        alt={alt}
        className="h-full w-full object-contain"
        height={512}
        fetchPriority={priority ? "high" : "auto"}
        loading="eager"
        sizes={sizes}
        src={visual.src}
        style={{ filter: visual.filter }}
        width={512}
      />
    </span>
  );
}
