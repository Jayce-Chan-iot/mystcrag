import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const resolveFromBackend = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));
const outputDirectory = resolveFromBackend("./dist");

// sharp is resolvable from asset-pipeline (its only legitimate consumer), not from the
// backend's own node_modules under pnpm's isolated layout. Resolve it once at build time
// — never a literal machine path — so the tree-shake plugin can hand esbuild a real path.
// The require condition yields `dist/index.cjs`; swap to the sibling `index.mjs` so esbuild
// loads the ESM entry it would otherwise have chosen (leaving the native `.node` binding
// external) instead of the CJS entry, whose raw `require` of `.node` files esbuild refuses
// to bundle.
const sharpEntry = createRequire(
  resolveFromBackend("../../packages/asset-pipeline/src/index.ts")
)
  .resolve("sharp")
  .replace(/index\.cjs$/, "index.mjs");

await rm(outputDirectory, { recursive: true, force: true });

const banner = {
  js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
};

// sharp is image-only and belongs to the asset worker via asset-pipeline's
// sharp-using modules (image-processor/quality/grouping). The backend imports only
// sharp-free symbols (`detectAssetSourceKind`, `sha256OfBytes`, `ArchiveStore`,
// `ArchiveStoreError`), but esbuild keeps `import sharp from "sharp"` because it is
// side-effectful, dragging the native binding into the API bundle. Marking sharp
// side-effect-free lets esbuild drop the otherwise dead chain, so the artifact no longer
// carries an unresolved native runtime asset.
const deadCodeEliminateSharp = {
  name: "backend-sharp-tree-shake",
  setup(build) {
    build.onResolve({ filter: /^sharp$/ }, () => ({ path: sharpEntry, sideEffects: false }));
  }
};

const result = await build({
  plugins: [deadCodeEliminateSharp],
  entryPoints: [resolveFromBackend("./src/index.ts")],
  outdir: outputDirectory,
  entryNames: "index",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner,
  external: ["fastify", "zod"],
  alias: {
    "@mystcrag/ai-agent/tarot": resolveFromBackend(
      "../../packages/ai-agent/src/tarot/index.ts"
    ),
    "@mystcrag/ai-agent": resolveFromBackend("../../packages/ai-agent/index.ts"),
    "@mystcrag/database": resolveFromBackend("../../packages/database/src/index.ts"),
    "@mystcrag/design-contract": resolveFromBackend(
      "../../packages/design-contract/src/index.ts"
    )
  },
  sourcemap: true,
  sourcesContent: true,
  metafile: true,
  logLevel: "info"
});

// jsdom's XMLHttpRequest-impl resolves its sibling worker via
// require.resolve("./xhr-sync-worker.js"), which esbuild cannot inline. Emit a
// self-contained runtime asset next to the bundle so that lookup resolves under a
// normal pnpm production layout (no NODE_PATH, no test harness, no symlink). Derive
// the source path from esbuild's own resolution rather than hardcoding a machine path.
const xhrImplInput = Object.keys(result.metafile.inputs).find((input) =>
  input.replace(/\\/g, "/").endsWith("/lib/jsdom/living/xhr/XMLHttpRequest-impl.js")
);

if (!xhrImplInput) {
  throw new Error(
    "jsdom XMLHttpRequest-impl.js not present in esbuild inputs; cannot derive xhr-sync-worker.js"
  );
}

await build({
  entryPoints: [path.join(path.dirname(xhrImplInput), "xhr-sync-worker.js")],
  outfile: path.join(outputDirectory, "xhr-sync-worker.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner,
  logLevel: "info"
});
