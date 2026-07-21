import type { Metadata } from "next";

import { DiyEditor } from "../../../src/features/design/components/diy-editor";

export const metadata: Metadata = { title: "DIY 手串编辑器" };

export default async function DiyDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DiyEditor designId={id} />;
}
