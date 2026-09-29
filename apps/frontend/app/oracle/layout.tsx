import type { ReactNode } from "react";

import { OracleQuestionProvider } from "../../src/features/oracle/oracle-question-provider";
import "../../src/features/oracle/oracle.module.css";

export default function OracleLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <OracleQuestionProvider>{children}</OracleQuestionProvider>;
}
