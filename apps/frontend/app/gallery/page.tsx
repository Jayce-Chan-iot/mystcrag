import type { Metadata } from "next";

import { GalleryPage } from "../../src/features/gallery/components/gallery-page";

export const metadata: Metadata = {
  title: "作品画廊"
};

export default function Page() {
  return <GalleryPage />;
}
