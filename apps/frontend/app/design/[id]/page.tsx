import type { Metadata } from "next";

import { DesignResults } from "../../../src/features/design/components/design-results";

export const metadata: Metadata = { title: "AI 设计方案" };

export default async function DesignResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DesignResults designId={id} />;
}
