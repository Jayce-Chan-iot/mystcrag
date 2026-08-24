import Image from "next/image";
import * as React from "react";

import { DISPLAY_TRAY_OPTIONS, type DisplayTrayMaterial } from "../model/display-tray";
import { getTrayVisual } from "../model/visual-assets";

export function DisplayTray({ material }: { material: DisplayTrayMaterial }) {
  const label = DISPLAY_TRAY_OPTIONS.find((option) => option.id === material)?.label ?? "米白骨瓷";
  const visual = getTrayVisual(material);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-display-tray={material}
    >
      <Image alt="" className="h-full w-full object-contain" fill priority sizes="(max-width: 767px) 94vw, 62vw" src={visual.src} />
      <span className="sr-only">{label}展示托盘，仅改变展示背景，不计入价格</span>
    </div>
  );
}
