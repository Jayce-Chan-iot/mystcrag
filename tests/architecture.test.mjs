import { access } from "node:fs/promises";
import test from "node:test";

const requiredPaths = [
  "apps/frontend/app",
  "apps/backend/src/modules",
  "packages/ui/src",
  "packages/ai-agent/emotion-agent",
  "packages/ai-agent/crystal-agent",
  "packages/ai-agent/design-agent",
  "packages/ai-agent/pricing-agent",
  "packages/ai-agent/compliance-agent",
  "packages/three-engine/bracelet-generator",
  "packages/three-engine/material-system",
  "packages/three-engine/bead-system",
  "packages/database/prisma/schema.prisma",
  "docs"
];

test("required monorepo boundaries exist", async () => {
  await Promise.all(requiredPaths.map((path) => access(path)));
});
