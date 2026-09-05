import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type FileDigest = {
  sha256: string;
  byteSize: number;
};

/**
 * Streams a file through SHA-256 instead of loading it into memory: source
 * photographs reach hundreds of megabytes and archival must not rely on the
 * whole payload being resident.
 */
export async function sha256OfFile(path: string): Promise<FileDigest> {
  const handle = await open(path, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let byteSize = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      byteSize += bytesRead;
    }
    return { sha256: hash.digest("hex"), byteSize };
  } finally {
    await handle.close();
  }
}
