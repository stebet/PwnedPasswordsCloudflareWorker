import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

process.env.HIBP_PURGE_CACHE_SECRET ??= "test-purge-secret";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./src/range-worker/wrangler.jsonc",
      },
      miniflare: {
        bindings: {
          HIBP_PURGE_CACHE_SECRET: "test-purge-secret",
        },
        serviceBindings: {
          BLOB_FETCHER: () => new Response("Blob service test double"),
        },
      },
    }),
  ],
  test: {
    coverage: {
      provider: "istanbul",
      reportsDirectory: "./coverage",
      reporter: ["cobertura"],
      include: ["src/range-worker/**/*.ts", "src/blob-worker/**/*.ts"],
    },
  },
});
