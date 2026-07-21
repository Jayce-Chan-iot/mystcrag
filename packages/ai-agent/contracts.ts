export type AgentContext = {
  readonly requestId: string;
  readonly locale: string;
};

export type AgentResult<TOutput> = {
  readonly data: TOutput;
  readonly warnings: readonly string[];
};

export interface Agent<TInput, TOutput> {
  readonly name: string;
  execute(input: TInput, context: AgentContext): Promise<AgentResult<TOutput>>;
}

export type BeadDesign = {
  readonly crystalId: string;
  readonly sizeMm: number;
  readonly count: number;
};

export type BraceletDesignOutput = {
  readonly designName: string;
  readonly story: string;
  readonly style: string;
  readonly beads: readonly BeadDesign[];
};
