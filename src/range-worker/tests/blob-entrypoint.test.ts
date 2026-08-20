import { describe, expect, it, vi } from "vitest";
import { processBlobRequest } from "../blob-entrypoint";
import { purgeWorkerCache } from "../cache-purge";

const blobEnv = {
  AZURE_CLIENT_ID: "client-id",
  AZURE_CLIENT_SECRET: "client-secret",
  AZURE_STORAGE_ACCOUNT: "pwnedpasswords",
  AZURE_TENANT_ID: "tenant-id",
  NTLM_BLOB_CONTAINER: "ntlm",
  SHA1_BLOB_CONTAINER: "sha1",
};

function mockEntraAndBlobFetch(blobResponse: Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("https://login.microsoftonline.com/")) {
      return new Response(JSON.stringify({ access_token: "test-access-token", expires_in: 3600 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.startsWith("https://pwnedpasswords.blob.core.windows.net/")) {
      return blobResponse;
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });
}

describe("Blob entrypoint", () => {
  it("returns the SHA-1 Blob content and a prefix cache tag", async () => {
    const fetchSpy = mockEntraAndBlobFetch(
      new Response("RANGE-DATA", {
        headers: {
          "Content-Length": "10",
          "Content-MD5": "RkFLRS1NRDU=",
        },
      }),
    );

    const response = await processBlobRequest(new Request("https://blob-entrypoint.internal/range/ABCDE"), blobEnv);

    expect(await response.text()).toBe("RANGE-DATA");
    expect(response.headers.get("Content-MD5")).toBe("RkFLRS1NRDU=");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000");
    expect(response.headers.get("Cache-Tag")).toBe("pwnedpasswords-ABCDE");
    const [blobUrl, blobOptions] = fetchSpy.mock.calls.find(([url]) => String(url).includes("pwnedpasswords.blob.core.windows.net")) ?? [];
    expect(String(blobUrl)).toBe("https://pwnedpasswords.blob.core.windows.net/sha1/ABCDE.txt");
    expect(blobOptions).toMatchObject({
      cf: {
        cacheEverything: true,
        cacheTags: ["pwnedpasswords-ABCDE"],
        cacheControl: "public, max-age=31536000",
      },
    });
    fetchSpy.mockRestore();
  });

  it("selects the NTLM container and tags the same prefix", async () => {
    const fetchSpy = mockEntraAndBlobFetch(new Response("RANGE-DATA"));
    const response = await processBlobRequest(new Request("https://blob-entrypoint.internal/range/ABCDE?mode=ntlm"), blobEnv);

    const [blobUrl] = fetchSpy.mock.calls.find(([url]) => String(url).includes("pwnedpasswords.blob.core.windows.net")) ?? [];
    expect(String(blobUrl)).toBe("https://pwnedpasswords.blob.core.windows.net/ntlm/ABCDE.txt");
    expect(response.headers.get("Cache-Tag")).toBe("pwnedpasswords-ABCDE");
    fetchSpy.mockRestore();
  });

  it("does not tag unsuccessful Blob responses", async () => {
    const fetchSpy = mockEntraAndBlobFetch(new Response("Blob not found", { status: 404 }));
    const response = await processBlobRequest(new Request("https://blob-entrypoint.internal/range/ABCDE"), blobEnv);

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Cache-Tag")).toBeNull();
    fetchSpy.mockRestore();
  });

  it("purges all or tagged Blob cache entries", async () => {
    const cache = {
      purge: vi.fn(async () => ({ errors: [], success: true })),
    };

    expect(await purgeWorkerCache(undefined, { cache })).toBe(true);
    expect(await purgeWorkerCache("pwnedpasswords-ABCDE", { cache })).toBe(true);
    expect(cache.purge).toHaveBeenNthCalledWith(1, { purgeEverything: true });
    expect(cache.purge).toHaveBeenNthCalledWith(2, { tags: ["pwnedpasswords-ABCDE"] });
  });

  it("treats unavailable local cache purging as a logged no-op", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await purgeWorkerCache()).toBe(true);
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
