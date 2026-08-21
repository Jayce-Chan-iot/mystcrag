import type { Metadata } from "next";
import type { ReactNode } from "react";

import { TarotQuestionDraftProvider } from "../../src/features/tarot/components/tarot-question-draft-provider";

export const metadata: Metadata = {
  title: "塔罗水晶引导",
  description: "从塔罗意象获得配色与水晶手串设计灵感。"
};

export default function TarotLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <TarotQuestionDraftProvider>{children}</TarotQuestionDraftProvider>;
}
