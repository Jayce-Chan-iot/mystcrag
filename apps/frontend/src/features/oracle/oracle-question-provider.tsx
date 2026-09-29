"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/** In-memory only: the optional Oracle question is never written outside this provider. */
export type OracleQuestionStore = {
  get(): string;
  set(question: string): void;
  clear(): void;
};

export function createOracleQuestionStore(): OracleQuestionStore {
  let question = "";

  return {
    get: () => question,
    set(next) {
      question = next;
    },
    clear() {
      question = "";
    }
  };
}

const OracleQuestionContext = createContext<OracleQuestionStore | null>(null);

export function OracleQuestionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [store] = useState(createOracleQuestionStore);

  return (
    <OracleQuestionContext.Provider value={store}>{children}</OracleQuestionContext.Provider>
  );
}

export function useOracleQuestionStore(): OracleQuestionStore {
  const store = useContext(OracleQuestionContext);
  if (store === null) {
    throw new Error("OracleQuestionProvider is required inside the Oracle route tree.");
  }
  return store;
}
