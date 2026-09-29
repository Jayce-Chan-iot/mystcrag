import { OracleResultClient } from "./oracle-result-client";

export default async function OracleResultPage({
  params
}: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const { sessionId } = await params;
  return <OracleResultClient sessionId={sessionId} />;
}
