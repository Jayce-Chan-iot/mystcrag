import { isMockApiEnabled } from "../lib/api/api-runtime";

export function DevelopmentModeBadge() {
  if (!isMockApiEnabled) return null;
  return (
    <p className="fixed bottom-20 right-4 z-50 rounded-full bg-[var(--warning)] px-3 py-2 text-xs font-semibold text-white shadow-lg sm:bottom-4" data-testid="mock-mode-badge">
      开发模式 · Mock API
    </p>
  );
}
