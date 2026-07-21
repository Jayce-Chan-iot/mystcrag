import type { PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";

export function DesignSummary({ design }: { design: PublicDesignV1 }) {
  return (
    <section aria-labelledby="design-summary-heading">
      <h2 id="design-summary-heading">{design.designName}</h2>
      <p>{design.story.designStory}</p>
      <p>{design.community.visibility === "PRIVATE" ? "Private" : design.community.visibility}</p>
    </section>
  );
}
