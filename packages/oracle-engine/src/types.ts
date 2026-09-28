export type CoinValue = 2 | 3;
export type OracleLineValue = 6 | 7 | 8 | 9;

export type CoinTriplet = readonly [CoinValue, CoinValue, CoinValue];
export type OracleLineTuple = readonly [
  OracleLineValue,
  OracleLineValue,
  OracleLineValue,
  OracleLineValue,
  OracleLineValue,
  OracleLineValue
];
export type CoinResultTuple = readonly [
  CoinTriplet,
  CoinTriplet,
  CoinTriplet,
  CoinTriplet,
  CoinTriplet,
  CoinTriplet
];
export type YangLineTuple = readonly [boolean, boolean, boolean, boolean, boolean, boolean];

export type OracleTrigram =
  | "HEAVEN"
  | "LAKE"
  | "FIRE"
  | "THUNDER"
  | "WIND"
  | "WATER"
  | "MOUNTAIN"
  | "EARTH";

export interface CoinSource {
  nextCoin(): CoinValue;
}

export interface HexagramDefinition {
  readonly number: number;
  readonly nameZh: string;
  readonly lowerTrigram: OracleTrigram;
  readonly upperTrigram: OracleTrigram;
}

export interface OracleCastDomain {
  readonly lines: OracleLineTuple;
  readonly coinResults: CoinResultTuple;
  readonly movingLineIndices: readonly number[];
  readonly primaryHexagram: HexagramDefinition;
  readonly transformedHexagram?: HexagramDefinition;
  readonly yinLineCount: number;
  readonly yangLineCount: number;
  readonly yangRatio: number;
  readonly algorithm: {
    readonly name: "THREE_COIN";
    readonly version: string;
  };
}
