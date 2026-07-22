export function resolveMockMode({
  nodeEnv = process.env.NODE_ENV,
  flag = process.env.NEXT_PUBLIC_MYSTCRAG_MOCK_API
}: {
  nodeEnv?: string;
  flag?: string;
} = {}): boolean {
  return nodeEnv !== "production" && flag === "true";
}

export const isMockApiEnabled = resolveMockMode();

export function resolveAccessToken(): string {
  return process.env.NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN?.trim() ?? "";
}
