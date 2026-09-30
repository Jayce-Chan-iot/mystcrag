import { useId } from "react";
import type { HTMLAttributes, ReactNode } from "react";

export type StatusPanelTone = "info" | "success" | "warning" | "danger";
export type StatusPanelRole = "status" | "alert" | "region";

export type StatusPanelProps = HTMLAttributes<HTMLElement> & {
  tone?: StatusPanelTone;
  role?: StatusPanelRole;
  title?: ReactNode;
  children: ReactNode;
};

export function StatusPanel({
  tone = "info",
  role = "status",
  title,
  children,
  className = "",
  ...props
}: StatusPanelProps) {
  const titleId = useId();
  const callerName = props["aria-label"] ?? props["aria-labelledby"];
  // role=region is a landmark and needs an accessible name. status/alert must not
  // auto-label or risk double announcement with live-region semantics.
  const regionNameProps =
    role === "region" && !callerName
      ? title
        ? { "aria-labelledby": titleId }
        : { "aria-label": "Status" }
      : {};

  return (
    <section
      {...props}
      {...regionNameProps}
      className={className}
      data-star-status-panel={tone}
      role={role}
    >
      {title ? (
        <strong data-star-status-title="true" id={titleId}>
          {title}
        </strong>
      ) : null}
      <div data-star-status-body="true">{children}</div>
    </section>
  );
}
