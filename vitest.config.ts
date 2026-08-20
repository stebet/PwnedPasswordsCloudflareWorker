import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

process.env.HIBP_PURGE_CACHE_SECRET ??= "test-purge-secret";
process.env.AZURE_STORAGE_ACCOUNT ||= "pwnedpasswords";
process.env.AZURE_CLIENT_ID ||= "client-id";
process.env.AZURE_TENANT_ID ||= "tenant-id";
process.env.SHA1_BLOB_CONTAINER ||= "sha1";
process.env.NTLM_BLOB_CONTAINER ||= "ntlm";
process.env.AZURE_CLIENT_SECRET ||= "client-secret";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./src/range-worker/wrangler.jsonc",
      },
      miniflare: {
        bindings: {
          AZURE_CLIENT_ID: "client-id",
          AZURE_CLIENT_SECRET: "client-secret",
          AZURE_STORAGE_ACCOUNT: "pwnedpasswords",
          AZURE_TENANT_ID: "tenant-id",
          HIBP_PURGE_CACHE_SECRET: "test-purge-secret",
          NTLM_BLOB_CONTAINER: "ntlm",
          SHA1_BLOB_CONTAINER: "sha1",
        },
      },
    }),
  ],
  test: {
    coverage: {
      provider: "istanbul",
      reportsDirectory: "./coverage",
      reporter: ["cobertura"],
      include: ["src/range-worker/**/*.ts"],
    },
  },
});
