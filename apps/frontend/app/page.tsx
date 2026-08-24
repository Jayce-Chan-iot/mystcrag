import Image from "next/image";
import Link from "next/link";

import { isTarotFeatureEnabled } from "../src/lib/api/api-runtime";

export const dynamic = "force-dynamic";

type CreationPath = {
  id: "ai" | "tarot" | "diy";
  title: string;
  description: string;
  note: string;
  href: string;
  action: string;
  image: string;
  imageAlt: string;
};

export default function HomePage() {
  const tarotEnabled = isTarotFeatureEnabled();
  const creationPaths: CreationPath[] = [
    {
      id: "ai",
      title: "AI 灵感设计",
      description: "从情绪、色彩、风格、手围与预算出发，生成三款可以继续调整的设计。",
      note: "五行意象仅作为文化与设计灵感。",
      href: "/ai-design",
      action: "开始 AI 设计",
      image: "/home/entry-ai.webp",
      imageAlt: "放有设计手稿与水晶手链的透明创作托盘"
    },
    ...(tarotEnabled
      ? [{
          id: "tarot" as const,
          title: "塔罗水晶引导",
          description: "选择一个主题与牌阵，从牌面色彩和意象中获得三款水晶搭配灵感。",
          note: "塔罗内容用于自我反思与设计灵感，不代表事实预测。",
          href: "/tarot/setup",
          action: "开始塔罗引导",
          image: "/home/entry-tarot.webp",
          imageAlt: "放有塔罗牌和水晶的透明创作托盘"
        }]
      : []),
    {
      id: "diy",
      title: "DIY 创作",
      description: "从光泽、色彩与排列中，自由创作只属于你的手串。",
      note: "直接进入珠子备选库，自由挑选与排列。",
      href: "/diy",
      action: "进入 DIY 创作",
      image: "/home/entry-diy.webp",
      imageAlt: "放有水晶手链与配件的透明创作托盘"
    }
  ];

  return (
    <main data-atelier-surface="home">
      <div className="home-reference-shell">
        <section className="home-reference-hero" data-reference-home-hero="true">
          <Image
            alt="米白色工作台上的浅紫与海蓝水晶手链"
            fill
            priority
            sizes="100vw"
            src="/home/hero-bracelet.webp"
          />
          <div className="home-reference-hero-copy">
            <h1>当灵感与矿石相遇，<br />每一串手链都是你的答案。</h1>
            <p>AI 设计 · 塔罗引导 · DIY 创作</p>
            <span>从你的当下、色彩与风格出发，为你提炼三种设计方向。每一颗珠子，都仍由你决定。</span>
          </div>
        </section>

        <section className="home-reference-paths" aria-label="选择创作方式" data-creation-path-group="true">
          {creationPaths.map((path) => (
            <article data-creation-path={path.id} key={path.id}>
              <Link aria-label={path.action} className="home-reference-card-link" href={path.href} title={path.action}>
                <div className="home-reference-entry-image" data-reference-entry-image="true">
                  <Image alt={path.imageAlt} fill sizes="(max-width: 767px) 44vw, 31vw" src={path.image} />
                </div>
                <div className="home-reference-entry-copy">
                  <h2>{path.title}</h2>
                  <p>{path.description}</p>
                  <small>{path.note}</small>
                  <span aria-hidden="true" className="home-reference-entry-arrow">→</span>
                </div>
              </Link>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
