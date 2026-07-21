import {
  PublicDesignV1Schema,
  type PublicDesignV1
} from "@mystcrag/design-contract";

import type { AgentResult } from "../contracts/agent";

export function designV1ToAgentOutput(input: unknown): AgentResult<PublicDesignV1> {
  return {
    data: PublicDesignV1Schema.parse(input),
    warnings: []
  };
}
