import assert from "node:assert/strict";
import test from "node:test";

import {
  HEXAGRAM_CATALOG,
  assertValidHexagramCatalog,
  lookupHexagramByYangLines
} from "../src/hexagrams";

test("the structural catalog contains every King Wen number exactly once", () => {
  assert.equal(HEXAGRAM_CATALOG.length, 64);
  assert.deepEqual(
    [...HEXAGRAM_CATALOG].map(({ number }) => number).sort((left, right) => left - right),
    Array.from({ length: 64 }, (_, index) => index + 1)
  );
  assert.equal(new Set(HEXAGRAM_CATALOG.map(({ nameZh }) => nameZh)).size, 64);
  assert.equal(Object.isFrozen(HEXAGRAM_CATALOG), true);
  assert.equal(HEXAGRAM_CATALOG.every(Object.isFrozen), true);
});

test("all 64 bottom-to-top binary patterns resolve uniquely", () => {
  const resolvedNumbers = new Set<number>();

  for (let pattern = 0; pattern < 64; pattern += 1) {
    const lines = Array.from({ length: 6 }, (_, index) => Boolean(pattern & (1 << index))) as [
      boolean,
      boolean,
      boolean,
      boolean,
      boolean,
      boolean
    ];
    resolvedNumbers.add(lookupHexagramByYangLines(lines).number);
  }

  assert.equal(resolvedNumbers.size, 64);
});

test("known lower and upper trigram ordering matches the structural catalog", () => {
  assert.deepEqual(lookupHexagramByYangLines([true, true, true, true, true, true]), {
    number: 1,
    nameZh: "乾",
    lowerTrigram: "HEAVEN",
    upperTrigram: "HEAVEN"
  });
  assert.deepEqual(lookupHexagramByYangLines([false, false, false, false, false, false]), {
    number: 2,
    nameZh: "坤",
    lowerTrigram: "EARTH",
    upperTrigram: "EARTH"
  });
  assert.deepEqual(lookupHexagramByYangLines([true, false, false, false, true, false]), {
    number: 3,
    nameZh: "屯",
    lowerTrigram: "THUNDER",
    upperTrigram: "WATER"
  });
});

test("catalog validation rejects duplicate numbers and duplicate trigram pairs", () => {
  const first = HEXAGRAM_CATALOG[0]!;
  const second = HEXAGRAM_CATALOG[1]!;

  assert.throws(
    () => assertValidHexagramCatalog([first, { ...second, number: first.number }]),
    /duplicate hexagram number/
  );
  assert.throws(
    () =>
      assertValidHexagramCatalog([
        first,
        { ...second, lowerTrigram: first.lowerTrigram, upperTrigram: first.upperTrigram }
      ]),
    /duplicate trigram pair/
  );
});
