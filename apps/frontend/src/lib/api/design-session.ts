import {
  CreateOrderFromDesignResponseSchema,
  type CreateOrderFromDesignResponse,
  type GenerateDesignRequest
} from "@mystcrag/design-contract";

const STORAGE_PREFIX = "mystcrag:generation:";
const OPTIONS_PREFIX = "mystcrag:options:";
const OVER_BUDGET_ACCEPTANCE_PREFIX = "mystcrag:over-budget-accepted:";
const ORDER_PREFIX = "mystcrag:order:";

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

export function saveGeneratedDesignOptions(
  routeDesignId: string,
  designIds: readonly string[],
  request: GenerateDesignRequest
): void {
  if (typeof window === "undefined") return;
  const uniqueIds = [...new Set(designIds)].filter(Boolean);
  window.sessionStorage.setItem(`${OPTIONS_PREFIX}${routeDesignId}`, JSON.stringify(uniqueIds));
  for (const designId of uniqueIds) saveDesignBudgetContext(designId, request);
}

export function loadGeneratedDesignOptions(routeDesignId: string): string[] {
  if (typeof window === "undefined") return [routeDesignId];
  const value = window.sessionStorage.getItem(`${OPTIONS_PREFIX}${routeDesignId}`);
  if (!value) return [routeDesignId];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
      return [routeDesignId];
    }
    return [...new Set(parsed)];
  } catch {
    return [routeDesignId];
  }
}

export function setOverBudgetAcceptance(designId: string, accepted: boolean): void {
  if (typeof window === "undefined") return;
  const key = `${OVER_BUDGET_ACCEPTANCE_PREFIX}${designId}`;
  if (accepted) window.sessionStorage.setItem(key, "true");
  else window.sessionStorage.removeItem(key);
}

export function hasOverBudgetAcceptance(designId: string): boolean {
  return typeof window !== "undefined" &&
    window.sessionStorage.getItem(`${OVER_BUDGET_ACCEPTANCE_PREFIX}${designId}`) === "true";
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

function orderStorageKey(designId: string, revision: number): string {
  return `${ORDER_PREFIX}${designId}:${revision}`;
}

export function saveCompletedOrder(response: CreateOrderFromDesignResponse): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    orderStorageKey(response.design.designId, response.design.revision),
    JSON.stringify(response)
  );
}

export function loadCompletedOrder(
  designId: string,
  revision: number
): CreateOrderFromDesignResponse | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(orderStorageKey(designId, revision));
  if (!value) return null;
  try {
    const response = CreateOrderFromDesignResponseSchema.parse(JSON.parse(value));
    if (response.design.designId !== designId || response.design.revision !== revision) return null;
    return response;
  } catch {
    window.localStorage.removeItem(orderStorageKey(designId, revision));
    return null;
  }
}
