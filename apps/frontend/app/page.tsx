import Link from "next/link";

import { isTarotFeatureEnabled } from "../src/lib/api/api-runtime";

export const dynamic = "force-dynamic";

const cases = [
  { name: "雨霁青", note: "海蓝 · 月光 · 清透银色", tone: "from-[#a8d7df] to-[#eef1eb]" },
  { name: "暮山紫", note: "紫晶 · 烟晶 · 古银", tone: "from-[#b8a4c7] to-[#e8dfd9]" },
  { name: "初雪白", note: "白水晶 · 月光 · 雾金", tone: "from-[#ece9df] to-[#cfd8d2]" }
];

function BraceletArtwork({ compact = false }: { compact?: boolean }) {
  const beads = Array.from({ length: compact ? 14 : 20 });

  return (
    <div className={`relative mx-auto aspect-square ${compact ? "w-48" : "w-[min(62vw,20rem)]"}`} aria-label="水晶手串设计视觉">
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
  const tarotEnabled = isTarotFeatureEnabled();
  const creationPaths = [
    {
      id: "ai",
      eyebrow: "AI Inspiration",
      title: "AI 灵感设计",
      description: "从情绪、色彩、风格、手围与预算出发，融入五行意象，生成三款可继续调整的设计。",
      note: "五行意象仅作为文化与设计灵感。",
      href: "/ai-design",
      action: "开始 AI 设计"
    },
    ...(tarotEnabled
      ? [{
          id: "tarot",
          eyebrow: "Tarot Guidance",
          title: "塔罗水晶引导",
          description: "选择一个主题与牌阵，从牌面色彩和意象中获得三款水晶搭配灵感。",
          note: "塔罗内容用于自我反思与设计灵感，不代表事实预测。",
          href: "/tarot/setup",
          action: "开始塔罗引导"
        }]
      : []),
    {
      id: "diy",
      eyebrow: "Free Creation",
      title: "DIY 创作",
      description: "从光泽、色彩与排列中，自由创作只属于你的手串。",
      note: "直接进入珠子备选库，自由挑选与排列。",
      href: "/diy",
      action: "进入 DIY 创作"
    }
  ];

  return (
    <main>
      <section className="mx-auto grid max-w-7xl items-center gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[1.2fr_.8fr] lg:py-14">
        <div className="animate-reveal-softly max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[var(--accent)]">玄矶 · Mystcrag</p>
          <h1 className="mt-6 font-serif text-5xl leading-[1.13] tracking-[-0.04em] sm:text-6xl lg:text-7xl">
            把此刻的心情，<br /><span className="text-[var(--accent-deep)]">串成一条手链。</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-8 text-[var(--muted)] sm:text-lg">
            从你的当下、色彩与风格出发，AI 为你提炼三种设计方向；每一颗珠子，都仍由你决定。
          </p>
        </div>
        <div className="animate-float-gently relative">
          <div className="absolute inset-[15%] rounded-full bg-[#d8cbe2]/50 blur-3xl" />
          <BraceletArtwork />
          <p className="absolute bottom-2 right-2 rounded-full border border-white/80 bg-white/70 px-4 py-2 text-xs text-[var(--muted)] backdrop-blur sm:bottom-5 sm:right-5">2.5D 水晶光影预览</p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 sm:pb-24" aria-labelledby="creation-paths-title">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--accent)]">Choose a path</p>
            <h2 className="mt-3 font-serif text-3xl sm:text-4xl" id="creation-paths-title">从你喜欢的方式开始</h2>
          </div>
          <p className="max-w-md text-sm leading-7 text-[var(--muted)]">{creationPaths.length === 3 ? "三种" : "两种"}创作方式拥有相同的设计自由，最终都可以进入 DIY 继续调整。</p>
        </div>
        <div className={`grid gap-5 ${creationPaths.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`} data-creation-path-group="true">
          {creationPaths.map((path) => (
            <article
              className="flex min-h-72 flex-col rounded-[2rem] border border-[var(--border)] bg-white/65 p-7 shadow-[0_18px_45px_rgb(61_47_70/0.06)]"
              data-creation-path={path.id}
              key={path.id}
            >
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[var(--accent)]">{path.eyebrow}</p>
              <h3 className="mt-5 font-serif text-3xl">{path.title}</h3>
              <p className="mt-4 leading-7 text-[var(--muted)]">{path.description}</p>
              <p className="mt-3 text-xs leading-6 text-[var(--muted)]">{path.note}</p>
              <Link
                className="mt-auto inline-flex min-h-12 items-center justify-between rounded-full bg-[var(--foreground)] px-6 text-sm text-white transition hover:-translate-y-0.5 hover:bg-[var(--accent-deep)]"
                href={path.href}
              >
                {path.action}<span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
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
