import { BeadImportWorkflow } from "../../../../src/features/admin-bead-import/components/bead-import-workflow";
import { requireBeadImportConsoleAccess } from "../../../../src/features/admin-bead-import/console-access";

export const dynamic = "force-dynamic";

/**
 * One import session. The guard runs before any session data is read, so a
 * stale or missing cookie redirects to the standalone login rather than
 * rendering a half-loaded task; the client container then rebuilds itself from
 * the Backend instead of inheriting anything from the dashboard.
 */
export default async function BeadImportSessionPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  await requireBeadImportConsoleAccess();
  const { sessionId } = await params;
  return <BeadImportWorkflow sessionId={sessionId} />;
}
