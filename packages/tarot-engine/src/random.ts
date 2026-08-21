import { randomInt } from "node:crypto";

import type { RandomSource } from "./types";

export class NodeCryptoRandomSource implements RandomSource {
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("maxExclusive must be a positive integer");
    }

    return randomInt(maxExclusive);
  }
}
