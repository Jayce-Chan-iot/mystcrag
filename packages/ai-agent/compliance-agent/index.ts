import type { Agent, BraceletDesignOutput } from "../contracts";

export type ComplianceAgentInput = {
  readonly design: BraceletDesignOutput;
};

export type ComplianceAgentOutput = {
  readonly approved: boolean;
  readonly issues: readonly { readonly code: string; readonly message: string }[];
};

export type ComplianceAgent = Agent<ComplianceAgentInput, ComplianceAgentOutput>;
