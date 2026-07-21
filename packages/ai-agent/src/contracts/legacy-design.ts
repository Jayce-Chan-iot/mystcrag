/**
 * @deprecated Use ordered DesignV1 bead components from @mystcrag/design-contract.
 * This grouped shape is retained only for Phase 2B compatibility.
 */
export type BeadDesign = {
  readonly crystalId: string;
  readonly sizeMm: number;
  readonly count: number;
};

/**
 * @deprecated New design workflows must validate AI candidates and produce DesignV1.
 * This type cannot preserve a final physical component sequence.
 */
export type BraceletDesignOutput = {
  readonly designName: string;
  readonly story: string;
  readonly style: string;
  readonly beads: readonly BeadDesign[];
};
