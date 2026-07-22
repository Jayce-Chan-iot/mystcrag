import type { GenerateDesignRequest } from "@mystcrag/design-contract";

const STORAGE_PREFIX = "mystcrag:generation:";

export type DesignBudgetContext = Pick<
  GenerateDesignRequest,
  "currency" | "minBudgetMinor" | "maxBudgetMinor"
>;

export function saveDesignBudgetContext(designId: string, request: GenerateDesignRequest): void {
  if (typeof window === "undefined") return;
  const context: DesignBudgetContext = {
    currency: request.currency,
    ...(request.minBudgetMinor === undefined ? {} : { minBudgetMinor: request.minBudgetMinor }),
    ...(request.maxBudgetMinor === undefined ? {} : { maxBudgetMinor: request.maxBudgetMinor })
  };
  window.sessionStorage.setItem(`${STORAGE_PREFIX}${designId}`, JSON.stringify(context));
}

export function loadDesignBudgetContext(designId: string): DesignBudgetContext | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(`${STORAGE_PREFIX}${designId}`);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("currency" in parsed)) return null;
    const context = parsed as Record<string, unknown>;
    if (context.currency !== "CNY" && context.currency !== "TWD") return null;
    if (context.minBudgetMinor !== undefined && !Number.isSafeInteger(context.minBudgetMinor)) return null;
    if (context.maxBudgetMinor !== undefined && !Number.isSafeInteger(context.maxBudgetMinor)) return null;
    return context as DesignBudgetContext;
  } catch {
    return null;
  }
}
