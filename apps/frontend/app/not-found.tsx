import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-3xl place-items-center px-5 py-16 text-center">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">404 · PAGE NOT FOUND</p>
        <h1 className="mt-5 font-serif text-4xl sm:text-6xl">没有找到这个页面</h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-[var(--muted)]">链接可能已经失效，或者页面仍在准备中。你可以返回首页重新开始。</p>
        <Link className="mt-8 inline-flex min-h-12 items-center rounded-full bg-[var(--accent-deep)] px-7 text-white transition hover:bg-[var(--accent)]" href="/">返回首页</Link>
      </div>
    </main>
  );
}
