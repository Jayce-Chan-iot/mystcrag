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

export function resolveActorId(): string {
  const configured = process.env.NEXT_PUBLIC_MYSTCRAG_ACTOR_ID?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "" : "user-phase-2c-demo";
}
