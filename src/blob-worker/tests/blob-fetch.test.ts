import { describe, expect, it, vi } from "vitest";
import * as worker from "../index";
import { mockEntraAndBlobFetch } from "./helpers/entra-fetch";
import { blobEnv } from "./helpers/worker-env";

describe("Azure Blob retrieval", () => {
  it("returns the SHA-1 Blob content and Content-MD5 header", async () => {
    const originResponse = new Response("RANGE-DATA", {
      headers: {
        "Content-Length": "10",
        "Content-MD5": "RkFLRS1NRDU=",
        "Cache-Control": "no-store",
      },
    });
    const fetchSpy = mockEntraAndBlobFetch(originResponse);
    const response = await worker.processRequest(new Request("https://blob-fetcher.internal/range/ABCDE"), blobEnv);

    expect(response).not.toBe(originResponse);
    expect(await response.text()).toBe("RANGE-DATA");
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.headers.get("Content-MD5")).toBe("RkFLRS1NRDU=");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000");
    expect(response.headers.get("Cache-Tag")).toBe("pwnedpasswords");
    const [tokenUrl, tokenOptions] = fetchSpy.mock.calls.find(([url]) => String(url).includes("login.microsoftonline.com")) ?? [];
    expect(String(tokenUrl)).toBe("https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token");
    expect(String(tokenOptions?.body)).toContain("client_id=client-id");
    expect(String(tokenOptions?.body)).toContain("grant_type=client_credentials");
    expect(String(tokenOptions?.body)).toContain("scope=https%3A%2F%2Fstorage.azure.com%2F.default");

    const [blobUrl, blobOptions] = fetchSpy.mock.calls.find(([url]) => String(url).includes("pwnedpasswords.blob.core.windows.net")) ?? [];
    expect(String(blobUrl)).toBe("https://pwnedpasswords.blob.core.windows.net/sha1/ABCDE.txt");
    expect(blobOptions).toMatchObject({
      headers: {
        Authorization: "Bearer test-access-token",
        "x-ms-version": "2023-11-03",
      },
      cf: {
        cacheEverything: true,
        cacheTags: ["pwnedpasswords"],
        cacheControl: "public, max-age=31536000",
        cacheReserveEligible: true,
        cacheTtlByStatus: {
          "200-299": 31536000,
          "300-599": -1,
        },
      },
    });
    expect(blobOptions?.cf).not.toHaveProperty("cacheKey");

    fetchSpy.mockRestore();
  });

  it("selects the NTLM container without exposing application credentials", async () => {
    const fetchSpy = mockEntraAndBlobFetch(
      new Response("RANGE-DATA", {
        headers: { "Content-MD5": "RkFLRS1NRDU=" },
      }),
    );
    const response = await worker.processRequest(new Request("https://blob-fetcher.internal/range/ABCDE?mode=ntlm"), blobEnv);

    const [blobUrl] = fetchSpy.mock.calls.find(([url]) => String(url).includes("pwnedpasswords.blob.core.windows.net")) ?? [];
    expect(String(blobUrl)).toBe("https://pwnedpasswords.blob.core.windows.net/ntlm/ABCDE.txt");
    expect(await response.text()).toBe("RANGE-DATA");

    fetchSpy.mockRestore();
  });

  it("returns Azure Blob failures with their HTTP status", async () => {
    const fetchSpy = mockEntraAndBlobFetch(new Response("Blob not found", { status: 404 }));
    const response = await worker.processRequest(new Request("https://blob-fetcher.internal/range/ABCDE"), blobEnv);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Blob not found");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Cache-Tag")).toBeNull();

    fetchSpy.mockRestore();
  });

  it("purges the Blob Worker cache through its RPC implementation", async () => {
    const cacheContext = {
      cache: {
        purge: vi.fn(async () => ({ errors: [], success: true })),
      },
    };

    expect(await worker.purgeWorkerCache(cacheContext)).toBe(true);
    expect(cacheContext.cache.purge).toHaveBeenCalledWith({ purgeEverything: true });
  });

  it("rejects requests outside the internal range contract", async () => {
    const methodResponse = await worker.processRequest(
      new Request("https://blob-fetcher.internal/range/ABCDE", { method: "POST" }),
      blobEnv,
    );
    const pathResponse = await worker.processRequest(new Request("https://blob-fetcher.internal/not-range/ABCDE"), blobEnv);

    expect(methodResponse.status).toBe(405);
    expect(pathResponse.status).toBe(400);
  });
});
