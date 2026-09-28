import { randomInt } from "node:crypto";

import type { CoinSource, CoinValue } from "./types";

export class NodeCryptoCoinSource implements CoinSource {
  nextCoin(): CoinValue {
    return randomInt(0, 2) === 0 ? 2 : 3;
  }
}
