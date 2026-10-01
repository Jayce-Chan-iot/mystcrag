import { SystemState } from "../components/page-scaffold";

/**
 * Route-level loading state. It renders the one shared system-state primitive so a
 * slow segment shows the canonical, motion-safe status panel instead of ad-hoc
 * skeleton copy.
 */
export default function Loading() {
  return (
    <main data-star-surface="system-state">
      <SystemState kind="loading" />
    </main>
  );
}