"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";

import { createOracleCoordinator } from "../../../../src/features/oracle/oracle-coordinator";
import {
  getOracleRevealPlan,
  OracleResult
} from "../../../../src/features/oracle/components/oracle-result";
import {
  readOracleFullMotionPreference,
  writeOracleFullMotionPreference
} from "../../../../src/features/oracle/oracle-motion-preference";
import { oracleApi } from "../../../../src/lib/api/oracle-api";

function nextOracleOperationId(): string {
  return crypto.randomUUID();
}

function subscribeFullMotion(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("oracle-full-motion-change", onChange);
  return () => window.removeEventListener("oracle-full-motion-change", onChange);
}

function getFullMotionEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return readOracleFullMotionPreference(window.localStorage);
  } catch {
    return true;
  }
}

function subscribePrefersReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function OracleRevealProgress({
  mode,
  durationMs,
  sessionId,
  children
}: Readonly<{
  mode: "full" | "short";
  durationMs: number;
  sessionId: string;
  children(revealProgress: number): ReactNode;
}>) {
  const [revealProgress, setRevealProgress] = useState(mode === "short" ? 1 : 0);

  useEffect(() => {
    if (mode === "short") return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(1, (now - start) / durationMs);
      setRevealProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, mode, sessionId]);

  return <>{children(revealProgress)}</>;
}

export function OracleResultClient({ sessionId }: Readonly<{ sessionId: string }>) {
  const router = useRouter();
  const prefersReducedMotion = useSyncExternalStore(
    subscribePrefersReducedMotion,
    getPrefersReducedMotion,
    () => false
  );
  const fullMotionEnabled = useSyncExternalStore(
    subscribeFullMotion,
    getFullMotionEnabled,
    () => true
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [localSelectedDesignId, setLocalSelectedDesignId] = useState<string | null>(null);
  const [snapshotVersion, setSnapshotVersion] = useState(0);

  const coordinator = useMemo(() => {
    return createOracleCoordinator({
      api: oracleApi,
      navigate: (nextSessionId) => {
        if (nextSessionId !== sessionId) {
          router.replace(`/oracle/result/${encodeURIComponent(nextSessionId)}`);
        }
      },
      now: () => 0
    });
  }, [router, sessionId]);

  useEffect(() => {
    return coordinator.subscribe(() => {
      setSnapshotVersion((value) => value + 1);
    });
  }, [coordinator]);

  // Restore from GET only — never create a new cast on refresh.
  useEffect(() => {
    void coordinator.restore(sessionId);
  }, [coordinator, sessionId]);

  const plan = getOracleRevealPlan({
    prefersReducedMotion,
    fullMotionEnabled
  });

  const snapshot = coordinator.getSnapshot();
  void snapshotVersion;

  const selectedDesignId =
    localSelectedDesignId ??
    snapshot.selectedDesignId ??
    snapshot.session?.selectedDesignId ??
    snapshot.session?.recommendations?.[0]?.design.designId ??
    null;

  return (
    <OracleRevealProgress
      durationMs={plan.durationMs}
      key={`${sessionId}-${plan.mode}`}
      mode={plan.mode}
      sessionId={sessionId}
    >
      {(revealProgress) => (
        <OracleResult
          detailsOpen={detailsOpen}
          fullMotionEnabled={fullMotionEnabled}
          onEnterDesign={() => {
            if (selectedDesignId === null) return;
            void coordinator.save(selectedDesignId).finally(() => {
              router.push(`/diy/${encodeURIComponent(selectedDesignId)}`);
            });
          }}
          onRetryRecommendations={() => {
            void coordinator.retryRecommendations();
          }}
          onSelectDesign={(designId) => {
            setLocalSelectedDesignId(designId);
          }}
          onToggleDetails={() => setDetailsOpen((value) => !value)}
          onToggleFullMotion={(enabled) => {
            try {
              writeOracleFullMotionPreference(window.localStorage, enabled);
            } catch {
              // Preference is best-effort; reduced motion still wins.
            }
            window.dispatchEvent(new Event("oracle-full-motion-change"));
          }}
          reveal={{
            mode: plan.mode,
            durationMs: plan.durationMs,
            revealProgress
          }}
          sessionId={sessionId}
          snapshot={{
            ...snapshot,
            selectedDesignId
          }}
        />
      )}
    </OracleRevealProgress>
  );
}

export { nextOracleOperationId };
