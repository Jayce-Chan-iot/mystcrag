import type { HTMLAttributes, ReactNode } from "react";

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function Surface({ children, className = "", ...props }: SurfaceProps) {
  return (
    <section className={`rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-10 ${className}`} {...props}>
      {children}
    </section>
  );
}
