import { access, readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const PREVIEW_PATH = "apps/frontend/src/features/design/components/three-bracelet-preview.tsx";
const SCENE_CLIENT_PATH = "apps/frontend/src/features/design/components/three-bracelet-scene-client.tsx";
const DIY_EDITOR_PATH = "apps/frontend/src/features/design/components/diy-editor.tsx";
const FLAT_EDITOR_PATH = "apps/frontend/src/features/design/components/flat-bracelet-editor.tsx";
const LIFECYCLE_MARKER_PATTERN = /export\s+const\s+THREE_BRACELET_PREVIEW_LIFECYCLE\s*=\s*["']EXPERIMENTAL_NOT_PRODUCTION_MOUNTED["']/;

// A production file is flagged when its source text contains ANY of these tokens,
// regardless of the referencing form: static import, alias import, re-export,
// dynamic import(), require(), JSX usage, bare identifier/type reference, or a
// path-like string. Raw substring matching deliberately avoids regex forms that
// could miss a reference style the guard author did not anticipate.
const FORBIDDEN_TOKENS = [
  "ThreeBraceletPreview",
  "ThreeBraceletSceneClient",
  "three-bracelet-preview",
  "three-bracelet-scene-client",
  "THREE_BRACELET_PREVIEW_LIFECYCLE",
];

const EXPERIMENTAL_COMPONENT_PATHS = new Set([
  path.normalize(PREVIEW_PATH),
  path.normalize(SCENE_CLIENT_PATH),
]);

function forbiddenTokenHits(source) {
  return FORBIDDEN_TOKENS.filter((token) => source.includes(token));
}

function isTestOrFixtureFile(file) {
  return /\.(?:test|spec)\.[^.]+$/.test(file) || file.split(path.sep).includes("fixtures");
}

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return ["node_modules", ".next", "dist", ".turbo"].includes(entry.name)
          ? []
          : sourceFiles(target);
      }
      return /\.(?:ts|tsx|js|mjs|jsx)$/.test(entry.name) ? [target] : [];
    })
  );
  return nested.flat();
}

async function productionReferencingFiles() {
  const roots = ["apps/frontend/app", "apps/frontend/src"];
  const files = (await Promise.all(roots.map((root) => access(root).then(() => sourceFiles(root), () => []))))
    .flat()
    .map((file) => path.normalize(file));
  const references = [];
  for (const file of files) {
    if (EXPERIMENTAL_COMPONENT_PATHS.has(file)) continue;
    if (isTestOrFixtureFile(file)) continue;
    const hits = forbiddenTokenHits(await readFile(file, "utf8"));
    if (hits.length > 0) references.push(`${file} (${hits.join(", ")})`);
  }
  return references;
}

test("the experimental 3D preview and scene client component files are retained", async () => {
  await access(PREVIEW_PATH);
  await access(SCENE_CLIENT_PATH);
});

test("ThreeBraceletPreview carries a machine-verifiable EXPERIMENTAL not-production-mounted lifecycle marker", async () => {
  const source = await readFile(PREVIEW_PATH, "utf8");
  assert.match(
    source,
    LIFECYCLE_MARKER_PATTERN,
    "ThreeBraceletPreview must export THREE_BRACELET_PREVIEW_LIFECYCLE = \"EXPERIMENTAL_NOT_PRODUCTION_MOUNTED\" to make its lifecycle machine-verifiable"
  );
});

test("no production file references the experimental 3D preview in any form", async () => {
  const references = await productionReferencingFiles();
  assert.deepEqual(
    references,
    [],
    `production files must not reference the experimental 3D preview tokens (${FORBIDDEN_TOKENS.join(", ")}): ${references.join("; ")}`
  );
});

test("FlatBraceletEditor remains the production DIY renderer wired by DiyEditor without 3D references", async () => {
  const diyEditor = await readFile(DIY_EDITOR_PATH, "utf8");
  assert.match(diyEditor, /FlatBraceletEditor/);
  assert.deepEqual(
    forbiddenTokenHits(diyEditor),
    [],
    "DiyEditor must not reference the experimental 3D preview"
  );
  await access(FLAT_EDITOR_PATH);
  const flatEditor = await readFile(FLAT_EDITOR_PATH, "utf8");
  assert.deepEqual(
    forbiddenTokenHits(flatEditor),
    [],
    "FlatBraceletEditor must not reference the experimental 3D preview"
  );
});

test("the detector itself recognizes every known reference form (guard against an always-green guard)", () => {
  const samples = {
    "static relative import": `import { ThreeBraceletPreview } from "./components/three-bracelet-preview";`,
    "alias import": `import { ThreeBraceletPreview } from "@/features/design/components/three-bracelet-preview";`,
    "re-export": `export { ThreeBraceletPreview } from "./three-bracelet-preview";`,
    "dynamic import": `const Preview = (await import("./three-bracelet-preview")).ThreeBraceletPreview;`,
    "require call": `const { ThreeBraceletPreview } = require("../components/three-bracelet-preview");`,
    "direct JSX symbol usage": `render(<ThreeBraceletPreview design={design} onSelect={onSelect} />);`,
    "bare type reference": `let preview: ThreeBraceletPreview | null = null;`,
    "lifecycle constant reference": `if (THREE_BRACELET_PREVIEW_LIFECYCLE === "EXPERIMENTAL_NOT_PRODUCTION_MOUNTED") {}`,
    "path-like string without imports": `const previewPath = "features/design/components/three-bracelet-preview";`,
    "scene client static import": `import { ThreeBraceletSceneClient } from "./three-bracelet-scene-client";`,
    "scene client path-like string": `const sceneClientPath = "components/three-bracelet-scene-client";`,
  };
  for (const [label, sample] of Object.entries(samples)) {
    assert.ok(
      forbiddenTokenHits(sample).length > 0,
      `detector failed to recognize reference form: ${label}`
    );
  }
  const innocuous = `import { FlatBraceletEditor } from "./flat-bracelet-editor";\nimport { BraceletPreview } from "./bracelet-preview";`;
  assert.deepEqual(
    forbiddenTokenHits(innocuous),
    [],
    "detector must not flag files that only reference the production or 2D preview editors"
  );
});

test("every non-component reference to the experimental 3D preview is a test or fixture file", async () => {
  const files = await sourceFiles("apps/frontend/src");
  for (const file of files) {
    const normalized = path.normalize(file);
    if (EXPERIMENTAL_COMPONENT_PATHS.has(normalized)) continue;
    const source = await readFile(file, "utf8");
    if (forbiddenTokenHits(source).length === 0) continue;
    assert.ok(
      isTestOrFixtureFile(normalized),
      `${file} references the experimental 3D preview but is neither a 3D component itself nor a test/fixture file`
    );
  }
});
