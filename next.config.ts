import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the build simple and predictable for a weekend MVP.
  // The x402 paywall and JSON store both need the Node.js runtime (set per-route).
};

export default nextConfig;
