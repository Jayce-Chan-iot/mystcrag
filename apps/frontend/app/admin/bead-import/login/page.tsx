import { loginAction } from "../../../../src/features/admin-bead-import/actions";
import { AdminLoginForm } from "../../../../src/features/admin-bead-import/components/admin-login-form";
import { isBeadImportConsoleConfigured } from "../../../../src/features/admin-bead-import/console-access";

export const dynamic = "force-dynamic";

export default async function BeadImportLoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = await isBeadImportConsoleConfigured();

  return <AdminLoginForm action={loginAction} configured={configured} error={error} />;
}
