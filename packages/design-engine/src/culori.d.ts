declare module "culori" {
  export type Oklch = { mode: "oklch"; l: number; c: number; h?: number };

  export function oklch(color: string): Oklch | undefined;
}
