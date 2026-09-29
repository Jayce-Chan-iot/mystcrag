import type { OracleLineValue } from "@mystcrag/design-contract";

export type { OracleLineValue };

export type OracleLineKind = "solid" | "broken";

export type OracleLineViewModel = {
  /** 1 = bottom (初爻), 6 = top (上爻). */
  readonly position: number;
  readonly value: OracleLineValue;
  readonly kind: OracleLineKind;
  readonly moving: boolean;
  readonly revealed: boolean;
  readonly label: string;
};

export type OracleLinesProps = Readonly<{
  lines: readonly OracleLineValue[];
  movingLineIndices: readonly number[];
  revealProgress: number;
}>;

export function getOracleLineViewModels({
  lines,
  movingLineIndices,
  revealProgress
}: OracleLinesProps): OracleLineViewModel[] {
  const moving = new Set(movingLineIndices);
  const progress = Math.min(1, Math.max(0, revealProgress));

  return lines.map((value, index) => {
    const position = index + 1;
    const isMoving = moving.has(position);
    // Reveal lights bottom-to-top: line 1 first, line 6 last.
    const threshold = (index + 1) / lines.length;
    const revealed = progress >= threshold || progress >= 1;
    return {
      position,
      value,
      kind: value === 7 || value === 9 ? "solid" : "broken",
      moving: isMoving,
      revealed,
      label: isMoving ? `动爻 ${position}` : `第 ${position} 爻`
    };
  });
}

export function OracleLines({ lines, movingLineIndices, revealProgress }: OracleLinesProps) {
  const viewModels = getOracleLineViewModels({ lines, movingLineIndices, revealProgress });

  return (
    <ol aria-label="六爻卦线（自下而上）" className="oracleLineStack" data-oracle-lines="true">
      {/* Visual hexagram stacks top line first; data stays bottom-to-top. */}
      {[...viewModels].reverse().map((line) => (
        <li
          className={`oracleLineRow${line.moving ? " oracleLineMoving" : ""}`}
          data-line-kind={line.kind}
          data-line-moving={line.moving ? "true" : "false"}
          data-line-position={line.position}
          data-line-revealed={line.revealed ? "true" : "false"}
          data-oracle-line={line.position}
          key={line.position}
        >
          <span className="oracleLineLabel">第 {line.position} 爻</span>
          <span
            aria-hidden="true"
            className={line.kind === "solid" ? "oracleLineSolid" : "oracleLineBroken"}
            data-line-kind={line.kind}
          />
          <span className="oracleLineLabel">{line.moving ? "动爻" : line.kind === "solid" ? "阳" : "阴"}</span>
        </li>
      ))}
    </ol>
  );
}
