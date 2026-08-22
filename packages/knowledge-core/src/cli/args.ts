import { KnowledgeStatusSchema } from "@mystcrag/design-contract";

export type ReviewCliCommand =
  | { command: "list"; status?: string; limit?: number }
  | { command: "show"; ruleId: string }
  | { command: "conflicts" }
  | { command: "run-pipeline" }
  | { command: "approve"; ruleId: string }
  | { command: "reject"; ruleId: string }
  | { command: "supersede"; ruleId: string }
  | { command: "publish"; version: string }
  | { command: "import-fixtures"; publishVersion?: string }
  | { command: "collect"; dryRun: boolean };

const COMMANDS = new Set([
  "list",
  "show",
  "conflicts",
  "run-pipeline",
  "approve",
  "reject",
  "supersede",
  "publish",
  "import-fixtures",
  "collect"
]);

/**
 * Parses review CLI arguments (task book section 34). Returns null with a
 * usage hint on stderr when the invocation is invalid.
 */
export function parseReviewCliArgs(argv: readonly string[]): ReviewCliCommand | null {
  const [command, ...rest] = argv;
  if (command === undefined || !COMMANDS.has(command)) {
    return null;
  }

  if (command === "list") {
    let status: string | undefined;
    let limit: number | undefined;
    for (let index = 0; index < rest.length; index += 1) {
      const flag = rest[index];
      const value = rest[index + 1];
      if (flag === "--status" && value !== undefined) {
        if (!KnowledgeStatusSchema.safeParse(value).success) return null;
        status = value;
        index += 1;
      } else if (flag === "--limit" && value !== undefined) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) return null;
        limit = parsed;
        index += 1;
      } else {
        return null;
      }
    }
    return { command: "list", status, limit };
  }

  if (command === "show" || command === "approve" || command === "reject" || command === "supersede") {
    if (rest.length !== 1 || rest[0]!.length === 0) return null;
    return { command, ruleId: rest[0]! } as ReviewCliCommand;
  }

  if (command === "publish") {
    if (rest.length !== 1 || rest[0]!.length === 0) return null;
    return { command: "publish", version: rest[0]! };
  }

  if (command === "import-fixtures") {
    if (rest.length === 0) return { command: "import-fixtures", publishVersion: undefined };
    if (rest.length === 2 && rest[0] === "--publish" && rest[1]!.length > 0) {
      return { command: "import-fixtures", publishVersion: rest[1]! };
    }
    return null;
  }

  if (command === "collect") {
    if (rest.length === 0) return { command: "collect", dryRun: false };
    if (rest.length === 1 && rest[0] === "--dry-run") return { command: "collect", dryRun: true };
    return null;
  }

  if (rest.length > 0) return null;
  return { command } as ReviewCliCommand;
}
