import { access, readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const COMPONENT_PATH = "apps/frontend/src/features/design/components/bracelet-sequence-editor.tsx";
const DIY_EDITOR_PATH = "apps/frontend/src/features/design/components/diy-editor.tsx";
const FLAT_EDITOR_PATH = "apps/frontend/src/features/design/components/flat-bracelet-editor.tsx";
const LIFECYCLE_MARKER_PATTERN = /export\s+const\s+BRACELET_SEQUENCE_EDITOR_LIFECYCLE\s*=\s*["']EXPERIMENTAL_TEST_ONLY["']/;

// A production file is flagged when its source text contains ANY of these tokens,
// regardless of the referencing form: static import, alias import, re-export,
// dynamic import(), require(), JSX usage, or a bare identifier/type reference.
// Raw substring matching deliberately avoids regex forms that could miss a
// reference style the guard author did not anticipate.
const FORBIDDEN_TOKENS = [
  "BraceletSequenceEditor",
  "BRACELET_SEQUENCE_EDITOR_LIFECYCLE",
  "bracelet-sequence-editor",
];

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
  const roots = ["apps/frontend/app", "apps/frontend/src", "apps/frontend/components"];
  const files = (await Promise.all(roots.map((root) => access(root).then(() => sourceFiles(root), () => []))))
    .flat()
    .map((file) => path.normalize(file));
  const references = [];
  for (const file of files) {
    if (file === path.normalize(COMPONENT_PATH)) continue;
    if (isTestOrFixtureFile(file)) continue;
    const hits = forbiddenTokenHits(await readFile(file, "utf8"));
    if (hits.length > 0) references.push(`${file} (${hits.join(", ")})`);
  }
  return references;
}

test("the dormant sequence editor component file is retained", async () => {
  await access(COMPONENT_PATH);
});

test("BraceletSequenceEditor carries a machine-verifiable EXPERIMENTAL test-only lifecycle marker", async () => {
  const source = await readFile(COMPONENT_PATH, "utf8");
  assert.match(
    source,
    LIFECYCLE_MARKER_PATTERN,
    "BraceletSequenceEditor must export BRACELET_SEQUENCE_EDITOR_LIFECYCLE = \"EXPERIMENTAL_TEST_ONLY\" to make its lifecycle machine-verifiable"
  );
});

test("no production file references the experimental sequence editor in any form", async () => {
  const references = await productionReferencingFiles();
  assert.deepEqual(
    references,
    [],
    `production files must not reference BraceletSequenceEditor, BRACELET_SEQUENCE_EDITOR_LIFECYCLE or bracelet-sequence-editor: ${references.join("; ")}`
  );
});

test("FlatBraceletEditor remains the production DIY renderer wired by DiyEditor", async () => {
  const diyEditor = await readFile(DIY_EDITOR_PATH, "utf8");
  assert.match(diyEditor, /FlatBraceletEditor/);
  await access(FLAT_EDITOR_PATH);
});

test("the detector itself recognizes every known reference form (guard against an always-green guard)", () => {
  const samples = {
    "static relative import": `import { BraceletSequenceEditor } from "./components/bracelet-sequence-editor";`,
    "alias import": `import { BraceletSequenceEditor } from "@/features/design/components/bracelet-sequence-editor";`,
    "re-export": `export { BraceletSequenceEditor } from "./bracelet-sequence-editor";`,
    "dynamic import": `const Editor = (await import("./bracelet-sequence-editor")).BraceletSequenceEditor;`,
    "require call": `const { BraceletSequenceEditor } = require("../components/bracelet-sequence-editor");`,
    "direct JSX symbol usage": `render(<BraceletSequenceEditor design={design} />);`,
    "bare type reference": `let editor: BraceletSequenceEditor | null = null;`,
    "lifecycle constant reference": `if (BRACELET_SEQUENCE_EDITOR_LIFECYCLE === "EXPERIMENTAL_TEST_ONLY") {}`,
    "path-like string without imports": `const editorPath = "features/design/components/bracelet-sequence-editor";`,
  };
  for (const [label, sample] of Object.entries(samples)) {
    assert.ok(
      forbiddenTokenHits(sample).length > 0,
      `detector failed to recognize reference form: ${label}`
    );
  }
  const innocuous = `import { FlatBraceletEditor } from "./flat-bracelet-editor";\nconst SequenceEditor = null;`;
  assert.deepEqual(
    forbiddenTokenHits(innocuous),
    [],
    "detector must not flag files that only reference other editors"
  );
});

test("every non-component reference to the experimental sequence editor is a test or fixture file", async () => {
  const files = await sourceFiles("apps/frontend/src");
  for (const file of files) {
    if (file === path.normalize(COMPONENT_PATH)) continue;
    const source = await readFile(file, "utf8");
    if (forbiddenTokenHits(source).length === 0) continue;
    assert.ok(
      isTestOrFixtureFile(file),
      `${file} references the experimental sequence editor but is neither the component itself nor a test/fixture file`
    );
  }
});
