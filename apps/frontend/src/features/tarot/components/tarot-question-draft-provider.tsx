"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type TarotQuestionDraft = Readonly<{
  question: string;
  saveQuestion: boolean;
  wristCircumferenceMm?: number;
}>;

export type TarotQuestionDraftStore = {
  get(sessionId: string): TarotQuestionDraft | undefined;
  set(sessionId: string, draft: TarotQuestionDraft): void;
  clear(sessionId: string): void;
};

export function createTarotQuestionDraftStore(): TarotQuestionDraftStore {
  const drafts = new Map<string, TarotQuestionDraft>();

  return {
    get(sessionId) {
      const draft = drafts.get(sessionId);
      return draft ? { ...draft } : undefined;
    },
    set(sessionId, draft) {
      drafts.set(sessionId, { ...draft });
    },
    clear(sessionId) {
      drafts.delete(sessionId);
    }
  };
}

const TarotQuestionDraftContext = createContext<TarotQuestionDraftStore | null>(null);

export function TarotQuestionDraftProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [store] = useState(createTarotQuestionDraftStore);

  return (
    <TarotQuestionDraftContext.Provider value={store}>
      {children}
    </TarotQuestionDraftContext.Provider>
  );
}

export function useTarotQuestionDraftStore(): TarotQuestionDraftStore {
  const store = useContext(TarotQuestionDraftContext);
  if (store === null) {
    throw new Error("TarotQuestionDraftProvider is required inside the Tarot route tree.");
  }
  return store;
}
