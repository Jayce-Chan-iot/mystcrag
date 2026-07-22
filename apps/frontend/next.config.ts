import type { NextConfig } from "next";

const backendOrigin = (process.env.MYSTCRAG_BACKEND_ORIGIN ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mystcrag/ui", "@mystcrag/design-contract"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendOrigin}/api/:path*` }];
  }
};

export default nextConfig;
