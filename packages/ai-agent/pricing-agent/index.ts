import type { Agent, BraceletDesignOutput } from "../contracts";

export type PricingAgentInput = {
  readonly design: BraceletDesignOutput;
  readonly currency: string;
};

export type PricingAgentOutput = {
  readonly amount: number;
  readonly currency: string;
  readonly lineItems: readonly { readonly label: string; readonly amount: number }[];
};

export type PricingAgent = Agent<PricingAgentInput, PricingAgentOutput>;
