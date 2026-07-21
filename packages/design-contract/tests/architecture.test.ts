import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const forbiddenDependencies = [
  "@prisma/client",
  "prisma",
  "three",
  "react",
  "next",
  "fastify",
  "openai",
  "anthropic",
  "@google/generative-ai"
];

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? listTypeScriptFiles(entryPath)
        : Promise.resolve(entry.name.endsWith(".ts") ? [entryPath] : []);
    })
  );
  return nestedFiles.flat();
}

test("design-contract has no forbidden runtime or development dependencies", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8")
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const declaredDependencies = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {})
  ]);

  for (const dependency of forbiddenDependencies) {
    assert.equal(declaredDependencies.has(dependency), false, `${dependency} must not be declared`);
  }
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}), ["zod"]);
});

test("design-contract source does not import forbidden frameworks or providers", async () => {
  const sourceFiles = await listTypeScriptFiles(path.join(packageRoot, "src"));
  const importPattern = /(?:from\s+|import\s*\()["']([^"']+)["']/g;

  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? "";
      assert.equal(
        forbiddenDependencies.some(
          (dependency) => specifier === dependency || specifier.startsWith(`${dependency}/`)
        ),
        false,
        `${sourceFile} imports forbidden dependency ${specifier}`
      );
    }
  }
});
