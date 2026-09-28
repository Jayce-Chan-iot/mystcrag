import assert from "node:assert/strict";
import test from "node:test";

import {
  ORACLE_CAST_ALGORITHM_VERSION,
  castThreeCoinHexagram,
  lineValueFromCoins,
  type CoinSource,
  type CoinValue
} from "../src/index";

class SequenceCoinSource implements CoinSource {
  readonly #values: CoinValue[];
  calls = 0;

  constructor(values: CoinValue[]) {
    this.#values = [...values];
  }

  nextCoin(): CoinValue {
    const value = this.#values[this.calls];
    assert.notEqual(value, undefined, "coin source was exhausted");
    this.calls += 1;
    return value!;
  }
}

test("all eight three-coin combinations prove the 1:3:3:1 line distribution", () => {
  const counts = new Map<number, number>([
    [6, 0],
    [7, 0],
    [8, 0],
    [9, 0]
  ]);

  for (const first of [2, 3] as const) {
    for (const second of [2, 3] as const) {
      for (const third of [2, 3] as const) {
        const value = lineValueFromCoins([first, second, third]);
        counts.set(value, counts.get(value)! + 1);
      }
    }
  }

  assert.deepEqual(Object.fromEntries(counts), { 6: 1, 7: 3, 8: 3, 9: 1 });
});

test("line calculation rejects any non-coin value even when the sum looks valid", () => {
  assert.throws(
    () => lineValueFromCoins([2, 2, 4] as unknown as readonly [2, 2, 2]),
    /exactly three coins with values 2 or 3/
  );
});

test("line calculation rejects short, long, and sparse runtime arrays", () => {
  const malformed = [
    [2, 3],
    [2, 2, 2, 3],
    Array(3)
  ];

  for (const coins of malformed) {
    assert.throws(
      () => lineValueFromCoins(coins as unknown as readonly [2, 2, 2]),
      /exactly three coins with values 2 or 3/
    );
  }
});

test("casting fails closed when an untyped source returns an invalid coin", () => {
  const source = { nextCoin: () => 4 } as unknown as CoinSource;
  assert.throws(() => castThreeCoinHexagram(source), /coin source must return 2 or 3/);
});

test("casting consumes exactly 18 coins and preserves bottom-to-top groups", () => {
  const values: CoinValue[] = [
    2, 2, 2,
    2, 2, 3,
    2, 3, 3,
    3, 3, 3,
    3, 2, 2,
    3, 3, 2
  ];
  const source = new SequenceCoinSource(values);

  const cast = castThreeCoinHexagram(source);

  assert.equal(source.calls, 18);
  assert.deepEqual(cast.lines, [6, 7, 8, 9, 7, 8]);
  assert.deepEqual(cast.coinResults, [
    [2, 2, 2],
    [2, 2, 3],
    [2, 3, 3],
    [3, 3, 3],
    [3, 2, 2],
    [3, 3, 2]
  ]);
  assert.deepEqual(cast.movingLineIndices, [1, 4]);
  assert.equal(cast.algorithm.name, "THREE_COIN");
  assert.equal(cast.algorithm.version, ORACLE_CAST_ALGORITHM_VERSION);
});

test("all moving yang becomes earth and all moving yin becomes heaven", () => {
  const movingYang = castThreeCoinHexagram(new SequenceCoinSource(Array(18).fill(3)));
  assert.equal(movingYang.primaryHexagram.number, 1);
  assert.equal(movingYang.primaryHexagram.nameZh, "乾");
  assert.equal(movingYang.transformedHexagram?.number, 2);
  assert.deepEqual(movingYang.movingLineIndices, [1, 2, 3, 4, 5, 6]);

  const movingYin = castThreeCoinHexagram(new SequenceCoinSource(Array(18).fill(2)));
  assert.equal(movingYin.primaryHexagram.number, 2);
  assert.equal(movingYin.primaryHexagram.nameZh, "坤");
  assert.equal(movingYin.transformedHexagram?.number, 1);
});

test("a static cast omits transformed structure and reports yin-yang balance", () => {
  const source = new SequenceCoinSource([
    2, 2, 3,
    2, 3, 3,
    2, 2, 3,
    2, 3, 3,
    2, 2, 3,
    2, 3, 3
  ]);

  const cast = castThreeCoinHexagram(source);

  assert.deepEqual(cast.lines, [7, 8, 7, 8, 7, 8]);
  assert.deepEqual(cast.movingLineIndices, []);
  assert.equal(cast.transformedHexagram, undefined);
  assert.equal(cast.yangLineCount, 3);
  assert.equal(cast.yinLineCount, 3);
  assert.equal(cast.yangRatio, 0.5);
});
