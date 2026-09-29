"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CreateOracleSessionRequestSchema } from "@mystcrag/design-contract";

import {
  createOracleSetupSubmitter,
  OracleSetup
} from "../../src/features/oracle/components/oracle-setup";
import { useOracleQuestionStore } from "../../src/features/oracle/oracle-question-provider";
import {
  toFrontendApiError,
  type FrontendErrorCode
} from "../../src/lib/api/frontend-api-error";
import { oracleApi } from "../../src/lib/api/oracle-api";

function nextOracleOperationId(kind: string): string {
  return `oracle-${kind}-${crypto.randomUUID()}`;
}

export function OracleSetupClient({ enabled }: Readonly<{ enabled: boolean }>) {
  const router = useRouter();
  const questionStore = useOracleQuestionStore();
  const [question, setQuestion] = useState(questionStore.get());
  const [wristCircumferenceMm, setWristCircumferenceMm] = useState<number | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<FrontendErrorCode | null>(null);

  const submit = (input: { question: string; wristCircumferenceMm: number | undefined }) => {
    const submitter = createOracleSetupSubmitter({
      questionStore,
      navigate: (path) => router.push(path),
      create: async (createInput) => {
        const request = CreateOracleSessionRequestSchema.parse({
          requestId: nextOracleOperationId("create-request"),
          operationId: nextOracleOperationId("create-operation"),
          locale: "zh-CN",
          currency: "CNY",
          ...(createInput.wristCircumferenceMm === undefined
            ? {}
            : { wristCircumferenceMm: createInput.wristCircumferenceMm }),
          ...(createInput.question ? { question: createInput.question } : {})
        });
        const response = await oracleApi.create(request);
        return { session: response.session };
      }
    });
    return submitter(input);
  };

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
        void submit({ question, wristCircumferenceMm })
          .catch((cause) => {
            setError(toFrontendApiError(cause).code);
          })
          .finally(() => {
            setIsSubmitting(false);
          });
      }}
      onWristChange={setWristCircumferenceMm}
      question={question}
      wristCircumferenceMm={wristCircumferenceMm}
    />
  );
}
