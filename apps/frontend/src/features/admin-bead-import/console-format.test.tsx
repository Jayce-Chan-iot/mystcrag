import assert from "node:assert/strict";
import test from "node:test";

import { formatByteSize, formatPercent, formatTimestamp } from "./console-format";

test("timestamps render in a fixed zone so the console reads the same everywhere", () => {
  assert.equal(formatTimestamp("2026-09-06T08:05:00.000Z"), "2026-09-06 16:05");
  assert.equal(formatTimestamp("2026-01-01T00:30:00.000Z"), "2026-01-01 08:30");
  assert.equal(formatTimestamp("2026-12-31T23:59:59.999Z"), "2027-01-01 07:59");
  assert.equal(formatTimestamp(null), "—");
  assert.equal(formatTimestamp("not-a-timestamp"), "—");
});

test("byte sizes stay short and never invent precision", () => {
  assert.equal(formatByteSize(0), "0 B");
  assert.equal(formatByteSize(1023), "1023 B");
  assert.equal(formatByteSize(1024), "1 KB");
  assert.equal(formatByteSize(2048), "2 KB");
  assert.equal(formatByteSize(1536), "1.5 KB");
  assert.equal(formatByteSize(256 * 1024 * 1024), "256 MB");
  assert.equal(formatByteSize(8 * 1024 * 1024 * 1024), "8 GB");
  assert.equal(formatByteSize(-1), "0 B");
});

test("progress percentages are rounded to one decimal and clamped", () => {
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(1), "100%");
  assert.equal(formatPercent(0.2534), "25.3%");
  assert.equal(formatPercent(0.9999), "100%");
  assert.equal(formatPercent(1.4), "100%");
  assert.equal(formatPercent(-0.2), "0%");
});
