import type { HTMLAttributes, ReactNode } from "react";

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function Surface({ children, className = "", ...props }: SurfaceProps) {
  return (
    <section className={`rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_24px_70px_rgb(57_45_67/0.06)] sm:p-10 ${className}`} {...props}>
      {children}
    </section>
  );
}
