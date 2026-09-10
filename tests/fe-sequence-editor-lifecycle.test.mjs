import { access, readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const COMPONENT_PATH = "apps/frontend/src/features/design/components/bracelet-sequence-editor.tsx";
const DIY_EDITOR_PATH = "apps/frontend/src/features/design/components/diy-editor.tsx";
const FLAT_EDITOR_PATH = "apps/frontend/src/features/design/components/flat-bracelet-editor.tsx";
const IMPORT_PATTERN = /["']\.\/components\/bracelet-sequence-editor["']|["']\.{1,2}\/(?:[^"']*\/)?bracelet-sequence-editor["']|from\s+["'][^"']*bracelet-sequence-editor["']/;
const LIFECYCLE_MARKER_PATTERN = /export\s+const\s+BRACELET_SEQUENCE_EDITOR_LIFECYCLE\s*=\s*["']EXPERIMENTAL_TEST_ONLY["']/;

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
    const isTest = /\.(?:test|spec)\.[^.]+$/.test(file);
    const isFixture = path.normalize(file).split(path.sep).includes("fixtures");
    const isTheComponentItself = file === path.normalize(COMPONENT_PATH);
    if (isTest || isFixture || isTheComponentItself) continue;
    if (IMPORT_PATTERN.test(await readFile(file, "utf8"))) references.push(file);
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

test("no production route, DIY editor, barrel or composition root references the experimental sequence editor", async () => {
  const references = await productionReferencingFiles();
  assert.deepEqual(
    references,
    [],
    `production files must not import BraceletSequenceEditor: ${references.join(", ")}`
  );
});

test("FlatBraceletEditor remains the production DIY renderer wired by DiyEditor", async () => {
  const diyEditor = await readFile(DIY_EDITOR_PATH, "utf8");
  assert.match(diyEditor, /FlatBraceletEditor/);
  await access(FLAT_EDITOR_PATH);
});

test("every non-component reference to the experimental sequence editor is a test or fixture file", async () => {
  const files = await sourceFiles("apps/frontend/src");
  for (const file of files) {
    const isTheComponentItself = file === path.normalize(COMPONENT_PATH);
    const source = await readFile(file, "utf8");
    if (isTheComponentItself || !/BraceletSequenceEditor/.test(source)) continue;
    const isTest = /\.(?:test|spec)\.[^.]+$/.test(file);
    const isFixture = file.split(path.sep).includes("fixtures");
    assert.ok(
      isTest || isFixture,
      `${file} references BraceletSequenceEditor but is neither the component itself nor a test/fixture file`
    );
  }
});
