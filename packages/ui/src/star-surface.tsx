import type { HTMLAttributes, ReactNode } from "react";

export type StarSurfaceTone = "ink" | "paper" | "lacquer";

export type StarSurfaceProps = HTMLAttributes<HTMLElement> & {
  tone?: StarSurfaceTone;
  children: ReactNode;
};

export function StarSurface({
  tone = "paper",
  children,
  className = "",
  ...props
}: StarSurfaceProps) {
  return (
    <section
      className={className}
      data-star-surface-tone={tone}
      {...props}
    >
      {children}
    </section>
  );
}
