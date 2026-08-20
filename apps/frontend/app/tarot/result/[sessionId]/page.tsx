import { TarotResult } from "../../../../src/features/tarot/components/tarot-result";

export default async function TarotResultPage({
  params
}: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const { sessionId } = await params;
  return <TarotResult sessionId={sessionId} />;
}
