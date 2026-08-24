import { Surface } from "@mystcrag/ui";

type PageScaffoldProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function PageScaffold({ eyebrow, title, description }: PageScaffoldProps) {
  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] max-w-6xl px-5 py-12 sm:py-20" data-atelier-surface="content-shell">
      <Surface className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">{eyebrow}</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">{title}</h1>
        <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--muted)] sm:text-lg">{description}</p>
        <p className="mt-10 border-t border-[var(--border)] pt-5 text-sm text-[var(--muted)]">工程骨架已就绪，业务能力将在后续迭代中接入。</p>
      </Surface>
    </main>
  );
}
