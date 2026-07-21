import type { Metadata } from "next";

import { QuestionnaireWizard } from "../../src/features/questionnaire/components/questionnaire-wizard";

export const metadata: Metadata = { title: "AI 设计问卷" };

export default function AiDesignPage() {
  return <QuestionnaireWizard />;
}
