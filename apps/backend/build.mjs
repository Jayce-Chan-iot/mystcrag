import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const resolveFromBackend = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));
const outputDirectory = resolveFromBackend("./dist");

await rm(outputDirectory, { recursive: true, force: true });

await build({
  entryPoints: [resolveFromBackend("./src/index.ts")],
  outdir: outputDirectory,
  entryNames: "index",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
  },
  external: ["fastify", "zod"],
  alias: {
    "@mystcrag/ai-agent": resolveFromBackend("../../packages/ai-agent/index.ts"),
    "@mystcrag/database": resolveFromBackend("../../packages/database/src/index.ts"),
    "@mystcrag/design-contract": resolveFromBackend(
      "../../packages/design-contract/src/index.ts"
    )
  },
  sourcemap: true,
  sourcesContent: true,
  logLevel: "info"
});
