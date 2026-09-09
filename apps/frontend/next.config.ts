import type { NextConfig } from "next";

/**
 * Mirrors the bead import manifest limit (ASSET_MANIFEST_LIMITS.maxFileBytes).
 * Next's proxy network boundary clones request bodies up to this size before
 * a route handler can stream them; the 10 MiB default truncated ~21 MiB
 * photographs mid-flight. Bounded to the manifest limit — never unlimited —
 * and the admin bead-import proxy still refuses anything larger itself.
 */
const ASSET_UPLOAD_MAX_BODY_BYTES = 256 * 1024 * 1024;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mystcrag/ui", "@mystcrag/design-contract", "@mystcrag/three-engine"],
  experimental: {
    proxyClientMaxBodySize: ASSET_UPLOAD_MAX_BODY_BYTES
  }
};

export default nextConfig;
