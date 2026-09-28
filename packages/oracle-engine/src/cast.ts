import { lookupHexagramByYangLines } from "./hexagrams";
import type {
  CoinResultTuple,
  CoinSource,
  CoinTriplet,
  CoinValue,
  OracleCastDomain,
  OracleLineTuple,
  OracleLineValue,
  YangLineTuple
} from "./types";

export const ORACLE_CAST_ALGORITHM_VERSION = "three-coin-v1" as const;

const isCoinValue = (value: unknown): value is CoinValue => value === 2 || value === 3;

export function lineValueFromCoins(coins: CoinTriplet): OracleLineValue {
  if (!coins.every(isCoinValue)) {
    throw new Error("each coin must be 2 or 3");
  }
  const value = coins[0] + coins[1] + coins[2];
  if (value < 6 || value > 9) {
    throw new Error(`invalid three-coin sum: ${value}`);
  }
  return value as OracleLineValue;
}

const isYang = (line: OracleLineValue): boolean => line === 7 || line === 9;
const isMoving = (line: OracleLineValue): boolean => line === 6 || line === 9;

const readCoin = (source: CoinSource): CoinValue => {
  const value: unknown = source.nextCoin();
  if (!isCoinValue(value)) {
    throw new Error("coin source must return 2 or 3");
  }
  return value;
};

export function castThreeCoinHexagram(source: CoinSource): OracleCastDomain {
  const coinResults = Array.from({ length: 6 }, () =>
    Object.freeze([readCoin(source), readCoin(source), readCoin(source)] as CoinTriplet)
  ) as unknown as CoinResultTuple;
  const lines = coinResults.map(lineValueFromCoins) as unknown as OracleLineTuple;
  const primaryYangLines = lines.map(isYang) as unknown as YangLineTuple;
  const movingLineIndices = Object.freeze(
    lines.flatMap((line, index) => (isMoving(line) ? [index + 1] : []))
  );
  const transformedYangLines = lines.map((line) =>
    isMoving(line) ? !isYang(line) : isYang(line)
  ) as unknown as YangLineTuple;
  const yangLineCount = primaryYangLines.filter(Boolean).length;

  return Object.freeze({
    lines: Object.freeze(lines),
    coinResults: Object.freeze(coinResults),
    movingLineIndices,
    primaryHexagram: lookupHexagramByYangLines(primaryYangLines),
    ...(movingLineIndices.length > 0
      ? { transformedHexagram: lookupHexagramByYangLines(transformedYangLines) }
      : {}),
    yinLineCount: 6 - yangLineCount,
    yangLineCount,
    yangRatio: yangLineCount / 6,
    algorithm: Object.freeze({
      name: "THREE_COIN" as const,
      version: ORACLE_CAST_ALGORITHM_VERSION
    })
  });
}
