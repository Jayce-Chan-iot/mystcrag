"use client";

import { SystemState } from "../components/page-scaffold";

/**
 * Route-level error boundary. Recovery is a real retry through Next's `reset`, not a
 * silent dismissal or a navigation: the shared panel renders exactly one button
 * action whose label says "重新加载".
 */
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main data-star-surface="system-state">
      <SystemState
        action={{ kind: "button", label: "重新加载", onAction: reset }}
        kind="error"
      />
    </main>
  );
}