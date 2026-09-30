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
  return (
    <section
      className={className}
      data-star-status-panel={tone}
      role={role}
      {...props}
    >
      {title ? <strong data-star-status-title="true">{title}</strong> : null}
      <div data-star-status-body="true">{children}</div>
    </section>
  );
}
