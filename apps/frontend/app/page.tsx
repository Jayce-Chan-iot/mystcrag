import Link from "next/link";

const cases = [
  { name: "雨霁青", note: "海蓝 · 月光 · 清透银色", tone: "from-[#a8d7df] to-[#eef1eb]" },
  { name: "暮山紫", note: "紫晶 · 烟晶 · 古银", tone: "from-[#b8a4c7] to-[#e8dfd9]" },
  { name: "初雪白", note: "白水晶 · 月光 · 雾金", tone: "from-[#ece9df] to-[#cfd8d2]" }
];

function BraceletArtwork({ compact = false }: { compact?: boolean }) {
  const beads = Array.from({ length: compact ? 14 : 20 });

  return (
    <div className={`relative mx-auto aspect-square ${compact ? "w-48" : "w-[min(78vw,31rem)]"}`} aria-label="3D 手串视觉集成占位">
      <div className="absolute inset-[12%] rounded-full border border-white/70 bg-[radial-gradient(circle_at_38%_30%,#fff,rgba(255,255,255,.18)_32%,rgba(104,78,127,.1)_70%)] shadow-[inset_0_0_70px_rgb(89_64_112/0.12),0_30px_80px_rgb(60_44_72/0.16)]" />
      {beads.map((_, index) => {
        const angle = (index / beads.length) * Math.PI * 2 - Math.PI / 2;
        const radius = 42;
        const x = 50 + Math.cos(angle) * radius;
        const y = 50 + Math.sin(angle) * radius;
        const palette = ["#9fc9d2", "#d9d4ca", "#b5a2c2", "#ece9df"];
        return (
          <span
            className="absolute h-[13%] w-[13%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 shadow-[inset_-5px_-7px_12px_rgb(70_48_86/0.18),inset_4px_4px_8px_rgb(255_255_255/0.8),0_5px_12px_rgb(57_45_67/0.16)]"
            key={index}
            style={{ background: palette[index % palette.length], left: `${x}%`, top: `${y}%` }}
          />
        );
      })}
    </div>
  );
}

export default function HomePage() {
  return (
    <main>
      <section className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-7xl items-center gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[1.04fr_.96fr] lg:py-20">
        <div className="animate-reveal-softly max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[var(--accent)]">玄矶 · Mystcrag</p>
          <h1 className="mt-7 font-serif text-5xl leading-[1.13] tracking-[-0.04em] sm:text-7xl lg:text-[5.3rem]">
            把此刻的心情，<br /><span className="text-[var(--accent-deep)]">串成一条手链。</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-8 text-[var(--muted)] sm:text-lg">
            从你的当下、色彩与风格出发，AI 为你提炼三种设计方向；每一颗珠子，都仍由你决定。
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link className="rounded-full bg-[var(--foreground)] px-7 py-3.5 text-center text-sm text-white transition hover:-translate-y-0.5 hover:bg-[var(--accent-deep)]" href="/ai-design">
              开始 AI 设计 <span aria-hidden="true">→</span>
            </Link>
            <Link className="rounded-full border border-[var(--border)] bg-white/55 px-7 py-3.5 text-center text-sm transition hover:border-[var(--accent)] hover:text-[var(--accent-deep)]" href="/diy">
              直接进入 DIY
            </Link>
          </div>
        </div>
        <div className="animate-float-gently relative">
          <div className="absolute inset-[15%] rounded-full bg-[#d8cbe2]/50 blur-3xl" />
          <BraceletArtwork />
          <p className="absolute bottom-2 right-2 rounded-full border border-white/80 bg-white/70 px-4 py-2 text-xs text-[var(--muted)] backdrop-blur sm:bottom-8 sm:right-8">3D 实时预览集成点</p>
        </div>
      </section>

      <section className="border-y border-[var(--border)] bg-[var(--surface)]/55 px-5 py-20 sm:px-8 sm:py-28" id="inspiration">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--accent)]">Design stories</p>
              <h2 className="mt-4 font-serif text-3xl sm:text-5xl">从感受到形与色</h2>
            </div>
            <p className="max-w-md leading-7 text-[var(--muted)]">不是为情绪下定义，而是将偏好转译成可以触摸、调整与拥有的设计。</p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {cases.map((item, index) => (
              <article className="group rounded-[2rem] border border-[var(--border)] bg-white/65 p-5 transition duration-500 hover:-translate-y-1 hover:shadow-[0_24px_60px_rgb(61_47_70/0.1)]" key={item.name}>
                <div className={`grid aspect-[4/3] place-items-center overflow-hidden rounded-[1.4rem] bg-gradient-to-br ${item.tone}`}>
                  <BraceletArtwork compact />
                </div>
                <div className="flex items-end justify-between px-2 pb-2 pt-6">
                  <div><p className="font-serif text-2xl">{item.name}</p><p className="mt-2 text-sm text-[var(--muted)]">{item.note}</p></div>
                  <span className="text-xs text-[var(--muted)]">0{index + 1}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-2 lg:items-center">
        <div className="max-w-xl">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--accent)]">Our belief</p>
          <h2 className="mt-5 font-serif text-4xl leading-tight sm:text-5xl">设计，是理解之后仍为你保留的自由。</h2>
        </div>
        <div className="space-y-5 border-l border-[var(--border)] pl-6 leading-8 text-[var(--muted)] sm:pl-10">
          <p>玄矶以审美和共创为核心。AI 提供灵感与结构，你可以继续替换、排序，让成品真正属于自己。</p>
          <p>水晶与东方文化意象仅作为创作参考，不用于医疗、心理诊断、保证功效或确定性命运判断。</p>
        </div>
      </section>
    </main>
  );
}
