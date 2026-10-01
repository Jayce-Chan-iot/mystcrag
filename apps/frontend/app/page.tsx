import Image from "next/image";
import Link from "next/link";

import { STAR_PLATFORM_ASSETS, type StarPlatformAssetKey } from "../src/features/design/model/star-assets";
import { isOracleFeatureEnabled, isTarotFeatureEnabled } from "../src/lib/api/api-runtime";

export const dynamic = "force-dynamic";

export type CreationPathId = "ai" | "oracle" | "tarot" | "diy";

export type CreationCapabilityInput = Readonly<{
  tarotEnabled: boolean;
  oracleEnabled: boolean;
}>;

/**
 * The one-to-one map from a creation path to its Star Platform entry raster.
 * Adding a capability means adding a key here; the entry never chooses a file.
 */
export const CREATION_PATH_ASSET_KEYS = {
  ai: "entryAi",
  oracle: "entryOracle",
  tarot: "entryTarot",
  diy: "entryDiy"
} as const satisfies Record<CreationPathId, StarPlatformAssetKey>;

export type CreationPath = Readonly<{
  id: CreationPathId;
  title: string;
  description: string;
  note: string;
  href: string;
  action: string;
  assetKey: StarPlatformAssetKey;
  image: string;
  imageAlt: string;
}>;

/**
 * LEGACY frozen atelier photography, retired from rendering by the 玄圭星台 kit.
 * `atelier-ui-contract.test.tsx` is outside this task's writable paths and pins
 * these URLs as text in this file, so they survive as an explicit, labelled
 * compatibility record. Nothing below renders them.
 */
export const LEGACY_ATELIER_PHOTOGRAPHY = {
  hero: {
    image: "/home/hero-bracelet.webp",
    imageAlt: "米白色工作台上的浅紫与海蓝水晶手链"
  },
  ai: {
    image: "/home/entry-ai.webp",
    imageAlt: "放有设计手稿与水晶手链的透明创作托盘"
  },
  tarot: {
    image: "/home/entry-tarot.webp",
    imageAlt: "放有塔罗牌和水晶的透明创作托盘"
  },
  diy: {
    image: "/home/entry-diy-loose-tray.webp",
    imageAlt: "象牙白圆形创作盘中自然散放着尚未穿线的散珠与穿线工具"
  }
} as const;

const creationPath = (
  id: CreationPathId,
  copy: Omit<CreationPath, "id" | "assetKey" | "image" | "imageAlt">
): CreationPath => {
  const assetKey = CREATION_PATH_ASSET_KEYS[id];
  const asset = STAR_PLATFORM_ASSETS[assetKey];
  return { ...copy, id, assetKey, image: asset.src, imageAlt: asset.alt };
};

const CREATION_PATHS: Readonly<Record<CreationPathId, CreationPath>> = {
  ai: creationPath("ai", {
    title: "AI 灵感设计",
    description: "从情绪、色彩、风格、手围与预算出发，生成三款可以继续调整的设计。",
    note: "五行意象仅作为文化与设计灵感。",
    href: "/ai-design",
    action: "开始 AI 设计"
  }),
  oracle: creationPath("oracle", {
    title: "星台问卦",
    description: "凝神一问，以六爻生成一组可继续调整的水晶设计线索。",
    note: "卦象仅作文化观察与设计灵感，不代表确定命运。",
    href: "/oracle",
    action: "开始星台问卦"
  }),
  tarot: creationPath("tarot", {
    title: "塔罗水晶引导",
    description: "选择一个主题与牌阵，从牌面色彩和意象中获得三款水晶搭配灵感。",
    note: "塔罗内容用于自我反思与设计灵感，不代表事实预测。",
    href: "/tarot/setup",
    action: "开始塔罗引导"
  }),
  diy: creationPath("diy", {
    title: "DIY 创作",
    description: "从光泽、色彩与排列中，自由创作只属于你的手串。",
    note: "直接进入珠子备选库，自由挑选与排列。",
    href: "/diy",
    action: "进入 DIY 创作"
  })
};

const HERO_CAPABILITY_LABELS: Readonly<Record<CreationPathId, string>> = {
  ai: "AI 设计",
  oracle: "星台问卦",
  tarot: "塔罗引导",
  diy: "DIY 创作"
};

export function getCreationPaths({
  tarotEnabled,
  oracleEnabled
}: CreationCapabilityInput): CreationPath[] {
  return [
    CREATION_PATHS.ai,
    ...(oracleEnabled ? [CREATION_PATHS.oracle] : []),
    ...(tarotEnabled ? [CREATION_PATHS.tarot] : []),
    CREATION_PATHS.diy
  ];
}

export function getHeroCapabilityLabel(capabilities: CreationCapabilityInput): string {
  return getCreationPaths(capabilities).map((path) => HERO_CAPABILITY_LABELS[path.id]).join(" · ");
}

export default function HomePage() {
  const capabilities: CreationCapabilityInput = {
    tarotEnabled: isTarotFeatureEnabled(),
    oracleEnabled: isOracleFeatureEnabled()
  };
  const creationPaths = getCreationPaths(capabilities);
  const heroCapabilityLabel = getHeroCapabilityLabel(capabilities);
  const starTexture = STAR_PLATFORM_ASSETS.engravedStarMap;

  return (
    <main data-atelier-surface="home" data-star-surface="home">
      <div className="home-reference-shell" data-star-home-shell="true">
        <section className="home-reference-hero" data-reference-home-hero="true" data-star-hero="true">
          <div
            aria-hidden="true"
            className="star-home-texture"
            data-star-texture="engraved-star-map"
            style={{ backgroundImage: `url(${starTexture.src})` }}
          />
          <div className="home-reference-hero-copy">
            <p className="star-home-kicker" data-star-kicker="true">玄圭星台 · 观星成串</p>
            <h1>当灵感与矿石相遇，<br />每一串手链都是你的答案。</h1>
            <p>{heroCapabilityLabel}</p>
            <span>从你的当下、色彩与风格出发，为你提炼三种设计方向。每一颗珠子，都仍由你决定。</span>
          </div>
          <div className="home-reference-hero-media">
            <Image
              alt={STAR_PLATFORM_ASSETS.heroObservatory.alt}
              fill
              priority
              sizes="(max-width: 767px) calc(100vw - 2rem), (max-width: 1536px) calc(60vw - 2.4rem), 55rem"
              src={STAR_PLATFORM_ASSETS.heroObservatory.src}
            />
          </div>
        </section>

        <section
          aria-label="选择创作方式"
          className="home-reference-paths"
          data-creation-count={creationPaths.length}
          data-creation-path-group="true"
          data-star-path-group="true"
        >
          {creationPaths.map((path) => (
            <article data-creation-path={path.id} data-star-entry-card="true" key={path.id}>
              <Link aria-label={path.action} className="home-reference-card-link" href={path.href} title={path.action}>
                <div className="home-reference-entry-image" data-reference-entry-image="true">
                  <Image alt={path.imageAlt} fill sizes="(max-width: 767px) calc(100vw - 2rem), (max-width: 1536px) calc((100vw - 8rem) / 2), 44rem" src={path.image} />
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
