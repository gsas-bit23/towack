import path from "node:path";
import type { NextConfig } from "next";

const EMPTY = "./src/stubs/empty-module.js";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The paid mint closed with no mints, so the router, rebates, referrals and Draw V1 pages were removed. Old links
  // (shared referral links, bookmarks, judges' notes) land on the closest live page instead of a 404.
  async redirects() {
    return [
      { source: "/trade", destination: "/swap", permanent: false },
      { source: "/rebates", destination: "/tokenomics", permanent: false },
      { source: "/referrals", destination: "/exchange", permanent: false },
      { source: "/r", destination: "/exchange", permanent: false },
      { source: "/r/:handle", destination: "/exchange", permanent: false },
      { source: "/draw", destination: "/lottery", permanent: false },
    ];
  },
  async rewrites() {
    // Short MCP endpoint for agents: https://towack.vercel.app/mcp
    return [{ source: "/mcp", destination: "/api/mcp" }];
  },
  turbopack: {
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    resolveAlias: {
      // Optional x402 deps of @coinbase/cdp-sdk (transitive via wagmi connectors); never used here.
      "@x402/core/client": EMPTY,
      "@x402/evm": "./src/stubs/x402-evm.js",
      "@x402/evm/exact/client": EMPTY,
      "@x402/evm/upto/client": EMPTY,
      "@x402/svm/exact/client": EMPTY,
    },
  },
};

export default nextConfig;
