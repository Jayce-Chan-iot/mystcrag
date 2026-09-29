import { notFound } from "next/navigation";

import { isOracleFeatureEnabled } from "../../../../src/lib/api/api-runtime";
import { OracleResultClient } from "./oracle-result-client";

export default async function OracleResultPage({
  params
}: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  if (!isOracleFeatureEnabled()) {
    notFound();
  }
  const { sessionId } = await params;
  return <OracleResultClient sessionId={sessionId} />;
}
