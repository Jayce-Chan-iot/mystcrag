import assert from "node:assert/strict";
import test from "node:test";

import {
  HEXAGRAM_CATALOG,
  assertValidHexagramCatalog,
  lookupHexagramByYangLines
} from "../src/hexagrams";
import { lookupTrigramByYangLines } from "../src/trigrams";

const FIXTURE_TRIGRAMS = [
  "HEAVEN",
  "LAKE",
  "FIRE",
  "THUNDER",
  "WIND",
  "WATER",
  "MOUNTAIN",
  "EARTH"
] as const;

// Independent regression fixture: rows are upper trigrams and columns are lower
// trigrams, both in the fixed local order above. It intentionally does not reuse engine data.
const EXPECTED_KING_WEN_BY_UPPER_LOWER = [
  ["1:乾", "10:履", "13:同人", "25:无妄", "44:姤", "6:讼", "33:遁", "12:否"],
  ["43:夬", "58:兑", "49:革", "17:随", "28:大过", "47:困", "31:咸", "45:萃"],
  ["14:大有", "38:睽", "30:离", "21:噬嗑", "50:鼎", "64:未济", "56:旅", "35:晋"],
  ["34:大壮", "54:归妹", "55:丰", "51:震", "32:恒", "40:解", "62:小过", "16:豫"],
  ["9:小畜", "61:中孚", "37:家人", "42:益", "57:巽", "59:涣", "53:渐", "20:观"],
  ["5:需", "60:节", "63:既济", "3:屯", "48:井", "29:坎", "39:蹇", "8:比"],
  ["26:大畜", "41:损", "22:贲", "27:颐", "18:蛊", "4:蒙", "52:艮", "23:剥"],
  ["11:泰", "19:临", "36:明夷", "24:复", "46:升", "7:师", "15:谦", "2:坤"]
] as const;

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

test("all eight bottom-to-top trigram patterns resolve against an independent fixture", () => {
  const expected = [
    [[true, true, true], "HEAVEN"],
    [[true, true, false], "LAKE"],
    [[true, false, true], "FIRE"],
    [[true, false, false], "THUNDER"],
    [[false, true, true], "WIND"],
    [[false, true, false], "WATER"],
    [[false, false, true], "MOUNTAIN"],
    [[false, false, false], "EARTH"]
  ] as const;

  for (const [lines, trigram] of expected) {
    assert.equal(lookupTrigramByYangLines(lines), trigram);
  }
});

test("every upper-lower pair matches the independent King Wen number and name fixture", () => {
  for (const [upperIndex, upperTrigram] of FIXTURE_TRIGRAMS.entries()) {
    for (const [lowerIndex, lowerTrigram] of FIXTURE_TRIGRAMS.entries()) {
      const actual = HEXAGRAM_CATALOG.find(
        (item) => item.upperTrigram === upperTrigram && item.lowerTrigram === lowerTrigram
      );
      assert.notEqual(actual, undefined);
      assert.equal(`${actual!.number}:${actual!.nameZh}`, EXPECTED_KING_WEN_BY_UPPER_LOWER[upperIndex]![lowerIndex]);
    }
  }
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
