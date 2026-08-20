import { TarotDraw } from "../../../../src/features/tarot/components/tarot-draw";

export default async function TarotDrawPage({
  params
}: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const { sessionId } = await params;
  return <TarotDraw sessionId={sessionId} />;
}
