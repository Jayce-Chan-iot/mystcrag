import type { Metadata } from "next";

import { CrystalLibraryPage } from "../../src/features/library/components/crystal-library-page";

export const metadata: Metadata = {
  title: "矿石库"
};

export default function Page() {
  return <CrystalLibraryPage />;
}
