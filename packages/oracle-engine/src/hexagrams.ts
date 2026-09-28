import { lookupTrigramByYangLines, TRIGRAMS } from "./trigrams";
import type { HexagramDefinition, OracleTrigram, YangLineTuple } from "./types";

const KING_WEN_NAMES = Object.freeze([
  "乾", "坤", "屯", "蒙", "需", "讼", "师", "比",
  "小畜", "履", "泰", "否", "同人", "大有", "谦", "豫",
  "随", "蛊", "临", "观", "噬嗑", "贲", "剥", "复",
  "无妄", "大畜", "颐", "大过", "坎", "离", "咸", "恒",
  "遁", "大壮", "晋", "明夷", "家人", "睽", "蹇", "解",
  "损", "益", "夬", "姤", "萃", "升", "困", "井",
  "革", "鼎", "震", "艮", "渐", "归妹", "丰", "旅",
  "巽", "兑", "涣", "节", "中孚", "小过", "既济", "未济"
] as const);

// Rows are upper trigrams; columns are lower trigrams, both in TRIGRAMS order.
const KING_WEN_NUMBER_MATRIX = Object.freeze([
  [1, 10, 13, 25, 44, 6, 33, 12],
  [43, 58, 49, 17, 28, 47, 31, 45],
  [14, 38, 30, 21, 50, 64, 56, 35],
  [34, 54, 55, 51, 32, 40, 62, 16],
  [9, 61, 37, 42, 57, 59, 53, 20],
  [5, 60, 63, 3, 48, 29, 39, 8],
  [26, 41, 22, 27, 18, 4, 52, 23],
  [11, 19, 36, 24, 46, 7, 15, 2]
] as const);

const pairKey = (lower: OracleTrigram, upper: OracleTrigram) => `${lower}:${upper}`;

export function assertValidHexagramCatalog(catalog: readonly HexagramDefinition[]): void {
  const numbers = new Set<number>();
  const names = new Set<string>();
  const pairs = new Set<string>();

  for (const item of catalog) {
    if (!Number.isInteger(item.number) || item.number < 1 || item.number > 64) {
      throw new Error(`invalid hexagram number: ${item.number}`);
    }
    if (numbers.has(item.number)) {
      throw new Error(`duplicate hexagram number: ${item.number}`);
    }
    if (names.has(item.nameZh)) {
      throw new Error(`duplicate hexagram name: ${item.nameZh}`);
    }
    const key = pairKey(item.lowerTrigram, item.upperTrigram);
    if (pairs.has(key)) {
      throw new Error(`duplicate trigram pair: ${key}`);
    }
    numbers.add(item.number);
    names.add(item.nameZh);
    pairs.add(key);
  }
}

const catalog = KING_WEN_NUMBER_MATRIX.flatMap((row, upperIndex) =>
  row.map((number, lowerIndex) =>
    Object.freeze({
      number,
      nameZh: KING_WEN_NAMES[number - 1]!,
      lowerTrigram: TRIGRAMS[lowerIndex]!,
      upperTrigram: TRIGRAMS[upperIndex]!
    })
  )
).sort((left, right) => left.number - right.number);

assertValidHexagramCatalog(catalog);
if (catalog.length !== 64) {
  throw new Error(`hexagram catalog must contain 64 entries; received ${catalog.length}`);
}

export const HEXAGRAM_CATALOG = Object.freeze(catalog);

const HEXAGRAM_BY_PAIR = new Map(
  HEXAGRAM_CATALOG.map((item) => [pairKey(item.lowerTrigram, item.upperTrigram), item] as const)
);

export function lookupHexagramByYangLines(lines: YangLineTuple): HexagramDefinition {
  const lowerTrigram = lookupTrigramByYangLines([lines[0], lines[1], lines[2]]);
  const upperTrigram = lookupTrigramByYangLines([lines[3], lines[4], lines[5]]);
  const hexagram = HEXAGRAM_BY_PAIR.get(pairKey(lowerTrigram, upperTrigram));
  if (hexagram === undefined) {
    throw new Error(`missing hexagram for ${lowerTrigram}:${upperTrigram}`);
  }
  return hexagram;
}
