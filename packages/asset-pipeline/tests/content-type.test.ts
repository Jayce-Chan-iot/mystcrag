import assert from "node:assert/strict";
import test from "node:test";

import { detectAssetSourceKind } from "../src/content-type.js";

test("detects JPEG from magic bytes regardless of extension", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(detectAssetSourceKind(jpeg), "JPEG");
});

test("detects PNG magic bytes", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  assert.equal(detectAssetSourceKind(png), "PNG");
});

test("detects WebP from RIFF container", () => {
  const webp = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38
  ]);
  assert.equal(detectAssetSourceKind(webp), "WEBP");
});

test("detects little-endian TIFF/ARW magic bytes", () => {
  const arw = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  assert.equal(detectAssetSourceKind(arw), "ARW");
});

test("detects big-endian TIFF/ARW magic bytes", () => {
  const arw = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
  assert.equal(detectAssetSourceKind(arw), "ARW");
});

test("returns null for unknown magic bytes even with a familiar extension", () => {
  const text = Buffer.from("not an image at all, just text pretending to be DSC01234.JPG");
  assert.equal(detectAssetSourceKind(text), null);
});

test("returns null for truncated buffers", () => {
  assert.equal(detectAssetSourceKind(new Uint8Array(0)), null);
  assert.equal(detectAssetSourceKind(Buffer.from([0xff, 0xd8])), null);
  assert.equal(detectAssetSourceKind(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00])), null);
});

test("never inspects anything beyond the header", () => {
  const jpegWithPngTail = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ]);
  assert.equal(detectAssetSourceKind(jpegWithPngTail), "JPEG");
});
