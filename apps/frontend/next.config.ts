import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mystcrag/ui", "@mystcrag/design-contract"]
};

export default nextConfig;
