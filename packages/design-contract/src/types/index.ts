export const FIXTURE_CATEGORIES = ["valid", "invalid", "flagged", "migration"] as const;

export type FixtureCategory = (typeof FIXTURE_CATEGORIES)[number];

export type ContractFixture<TData = unknown> = {
  readonly category: FixtureCategory;
  readonly description: string;
  readonly data: TData;
};
