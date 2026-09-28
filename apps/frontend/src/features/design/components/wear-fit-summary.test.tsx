import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PublicDesignV1 } from "@mystcrag/design-contract";

import { mockDesignOptions } from "../fixtures/mock-design-options";
import { evaluateBraceletFit } from "../model/bracelet-fit";
import { WearFitSummary } from "./wear-fit-summary";

function wearFitDesign(): PublicDesignV1 {
  const design = structuredClone(mockDesignOptions[0]!);
  design.accessories = [];
  design.bracelet = {
    ...design.bracelet,
    elasticAllowanceMm: 5,
    targetInnerCircumferenceMm: 160,
    wristCircumferenceMm: 155
  };
  design.beads = [
    {
      ...design.beads[0]!,
      componentId: "bead-wear-fit",
      diameterMm: 158,
      lengthAlongStringMm: undefined,
      positionIndex: 0
    }
  ];
  return design;
}

test("wear fit summary labels every measurement distinctly and never calls the material path a wrist", () => {
  const markup = renderToStaticMarkup(<WearFitSummary fit={evaluateBraceletFit(wearFitDesign())} />);
  assert.match(markup, /腕围/);
  assert.match(markup, /目标内周长/);
  assert.match(markup, /当前材料路径/);
  assert.match(markup, /结构余量/);
  assert.match(markup, /距目标/);
  assert.match(markup, /15\.5 cm/);
  assert.match(markup, /16\.0 cm/);
  assert.match(markup, /15\.8 cm/);
  assert.match(markup, /0\.5 cm/);
  assert.match(markup, /-0\.2 cm/);
  assert.match(markup, /data-wear-fit-summary="true"/);
  assert.doesNotMatch(markup, /推荐成品内径/);
  assert.doesNotMatch(markup, /5\.0–5\.2 cm/);
});

test("wear fit summary keeps advisories non-blocking and the measurement guidance collapsible", () => {
  const design = wearFitDesign();
  design.beads = [{ ...design.beads[0]!, diameterMm: 120 }];
  const markup = renderToStaticMarkup(<WearFitSummary fit={evaluateBraceletFit(design)} />);
  assert.match(markup, /data-wear-fit-status="TOO_SMALL"/);
  assert.match(markup, /<details/);
  assert.match(markup, /常见建议范围 13\.0–20\.0cm，不影响完成设计/);
  assert.doesNotMatch(markup, /disabled/);
});

test("the editors never reintroduce the fabricated diameter range or the retired wrist mislabels", () => {
  for (const file of ["diy-editor.tsx", "flat-bracelet-editor.tsx"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /推荐成品内径/);
    assert.doesNotMatch(source, /5\.0–5\.2 cm/);
    assert.doesNotMatch(source, /预计适配手围/);
    assert.doesNotMatch(source, /<dt>手围<\/dt>/);
    assert.doesNotMatch(source, /braceletFit\.message/);
  }
});
