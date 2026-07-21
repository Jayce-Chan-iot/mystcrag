import type { Agent, BraceletDesignOutput } from "../contracts";

export type DesignAgentInput = {
  readonly crystalIds: readonly string[];
  readonly style: string;
  readonly budget?: { readonly min: number; readonly max: number };
};

export type DesignAgent = Agent<DesignAgentInput, BraceletDesignOutput>;
