import type { Metadata } from "next";

import { ProfilePage } from "../../src/features/profile/components/profile-page";

export const metadata: Metadata = {
  title: "个人中心"
};

export default function Page() {
  return <ProfilePage />;
}
