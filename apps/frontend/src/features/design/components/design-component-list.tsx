import type { PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";

import { toDesignComponentViewModels } from "../model/design-component-view-model";

export function DesignComponentList({ design }: { design: PublicDesignV1 }) {
  return (
    <section aria-labelledby="design-components-heading">
      <h3 id="design-components-heading">Components</h3>
      <ol>
        {toDesignComponentViewModels(design).map((component) => (
          <li key={component.componentId} data-component-id={component.componentId}>
            <span>{component.label}</span> <small>{component.placement}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
