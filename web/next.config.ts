import path from "node:path";
import type { NextConfig } from "next";

const EMPTY = "./src/stubs/empty-module.js";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Referral landing: /r/<handle>?ref=<address> is served by the static /r page (handle read client-side from the
  // path), so the shared Nav's usePathname() never blocks prerendering of a dynamic segment.
  async rewrites() {
    return [{ source: "/r/:handle", destination: "/r" }];
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
