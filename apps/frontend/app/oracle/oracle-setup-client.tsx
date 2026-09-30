"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  CreateOracleSessionRequestSchema,
  type CreateOracleSessionRequest
} from "@mystcrag/design-contract";

import {
  createOracleSetupSubmitter,
  OracleSetup,
  type OracleSetupInput
} from "../../src/features/oracle/components/oracle-setup";
import {
  useOracleQuestionStore,
  type OracleQuestionStore
} from "../../src/features/oracle/oracle-question-provider";
import {
  toFrontendApiError,
  type FrontendErrorCode
} from "../../src/lib/api/frontend-api-error";
import { oracleApi } from "../../src/lib/api/oracle-api";

function nextOracleOperationId(kind: string): string {
  return `oracle-${kind}-${crypto.randomUUID()}`;
}

export type OracleSetupClientSubmitter = (input: OracleSetupInput) => Promise<void>;

export type OracleSetupClientDependencies = Readonly<{
  questionStore: OracleQuestionStore;
  navigate(path: string): void;
  createSession(request: CreateOracleSessionRequest): Promise<{ session: { sessionId: string } }>;
  nextOperationId(kind: string): string;
}>;

export function createOracleSetupClientSubmitter({
  questionStore,
  navigate,
  createSession,
  nextOperationId
}: OracleSetupClientDependencies): OracleSetupClientSubmitter {
  // The in-flight guard lives inside the returned submitter, so it must be built
  // once and reused across activations instead of per submit() call.
  return createOracleSetupSubmitter({
    questionStore,
    navigate,
    create: async (createInput) => {
      const request = CreateOracleSessionRequestSchema.parse({
        requestId: nextOperationId("create-request"),
        operationId: nextOperationId("create-operation"),
        locale: "zh-CN",
        currency: "CNY",
        ...(createInput.wristCircumferenceMm === undefined
          ? {}
          : { wristCircumferenceMm: createInput.wristCircumferenceMm }),
        ...(createInput.question ? { question: createInput.question } : {})
      });
      const response = await createSession(request);
      return { session: response.session };
    }
  });
}

export function OracleSetupClient({ enabled }: Readonly<{ enabled: boolean }>) {
  const router = useRouter();
  const questionStore = useOracleQuestionStore();
  const [question, setQuestion] = useState(questionStore.get());
  const [wristCircumferenceMm, setWristCircumferenceMm] = useState<number | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<FrontendErrorCode | null>(null);
  const [submitter] = useState<OracleSetupClientSubmitter>(() =>
    createOracleSetupClientSubmitter({
      questionStore,
      navigate: (path) => router.push(path),
      createSession: (request) => oracleApi.create(request),
      nextOperationId: nextOracleOperationId
    })
  );

  if (!enabled) {
    return (
      <main className="oraclePage" data-oracle-setup="true" data-oracle-disabled="true">
        <div className="oracleShell">
          <header className="oracleHero">
            <p className="oracleEyebrow">玄圭星台</p>
            <h1 className="oracleTitle">星台问卦</h1>
            <p className="oracleLede">当前环境尚未开放星台问卦。你仍可使用 AI 设计或 DIY 创作。</p>
          </header>
          <p className="oracleNotice">功能开启后，这里会出现一键「启卦」入口。</p>
        </div>
      </main>
    );
  }

  return (
    <OracleSetup
      error={error}
      isSubmitting={isSubmitting}
      onQuestionChange={(value) => {
        questionStore.set(value);
        setQuestion(value);
      }}
      onSubmit={() => {
        setIsSubmitting(true);
        setError(null);
        // isSubmitting stays true after a successful create until the route unmounts this
        // screen, so the button cannot re-enable inside the navigation-commit window.
        // Only a rejection restores it for the retry path.
        void submitter({ question, wristCircumferenceMm }).catch((cause) => {
          setError(toFrontendApiError(cause).code);
          setIsSubmitting(false);
        });
      }}
      onWristChange={setWristCircumferenceMm}
      question={question}
      wristCircumferenceMm={wristCircumferenceMm}
    />
  );
}
