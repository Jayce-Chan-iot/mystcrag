/**
 * @deprecated Use ordered DesignV1 bead components from @mystcrag/design-contract.
 */
export type BraceletBeadConfiguration = {
  readonly crystalId: string;
  readonly sizeMm: number;
  readonly count: number;
};

/**
 * @deprecated New rendering adapters consume DesignV1 directly.
 */
export type BraceletConfiguration = {
  readonly designId: string;
  readonly beads: readonly BraceletBeadConfiguration[];
};
