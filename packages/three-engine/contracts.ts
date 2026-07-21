export type BraceletBeadConfiguration = {
  readonly crystalId: string;
  readonly sizeMm: number;
  readonly count: number;
};

export type BraceletConfiguration = {
  readonly designId: string;
  readonly beads: readonly BraceletBeadConfiguration[];
};
