import { BeadImportDashboard } from "../../../src/features/admin-bead-import/components/bead-import-dashboard";
import { requireBeadImportConsoleAccess } from "../../../src/features/admin-bead-import/console-access";

export const dynamic = "force-dynamic";

/**
 * The guard runs on every request, before any session data is read: a stale or
 * missing cookie is redirected to the standalone login page rather than served
 * an empty console.
 */
export default async function BeadImportDashboardPage() {
  await requireBeadImportConsoleAccess();
  return <BeadImportDashboard />;
}
