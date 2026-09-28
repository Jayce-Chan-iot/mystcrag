import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Gallery and Profile empty states promise only always-available creation paths", () => {
  const gallery = source("../gallery/components/gallery-page.tsx");
  const profile = source("../profile/components/profile-page.tsx");

  assert.doesNotMatch(gallery, /塔罗引导/);
  assert.match(gallery, /从 AI 设计或 DIY 创作开始/);
  assert.match(gallery, /href="\/diy"/);

  assert.doesNotMatch(profile, /塔罗引导/);
  assert.match(profile, /href="\/ai-design"[^>]*>AI 设计/);
  assert.match(profile, /href="\/diy"[^>]*>DIY 创作/);
});
