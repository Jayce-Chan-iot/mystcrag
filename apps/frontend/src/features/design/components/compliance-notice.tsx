import type { PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";

const statusCopy = {
  PASSED: "Compliance review passed.",
  PENDING: "Compliance review is pending.",
  FLAGGED: "This design requires compliance review.",
  REJECTED: "This design cannot be published or ordered."
} as const;

export function ComplianceNotice({ design }: { design: PublicDesignV1 }) {
  const status = design.compliance.complianceStatus;

  return (
    <aside aria-label="Compliance status" data-compliance-status={status}>
      <p>{statusCopy[status]}</p>
      {design.compliance.disclaimerKeys.map((key) => (
        <small key={key}>{key}</small>
      ))}
    </aside>
  );
}
