import { describe, expect, it, vi } from "vitest";
import { processPurgeRequest } from "../index";

const cacheEnv = {
  HIBP_PURGE_CACHE_SECRET: "purge-secret",
};

function createCachePurger(success = true) {
  return {
    purgeCache: vi.fn(async (_tag?: string) => success),
  };
}

describe("purge entrypoint", () => {
  it.each(["/purge", "/purge/"])("purges all ranges for %s", async (path) => {
    const blobCache = createCachePurger();
    const rangeCache = createCachePurger();

    const response = await processPurgeRequest(
      new Request(`https://example.com${path}`, {
        headers: { Authorization: "Bearer purge-secret" },
      }),
      cacheEnv,
      blobCache,
      rangeCache,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(blobCache.purgeCache).toHaveBeenCalledWith(undefined);
    expect(rangeCache.purgeCache).toHaveBeenCalledWith(undefined);
  });

  it("purges one normalized range tag across both hash modes", async () => {
    const operations: string[] = [];
    const blobCache = createCachePurger();
    const rangeCache = createCachePurger();
    blobCache.purgeCache.mockImplementation(async () => {
      operations.push("blob");
      return true;
    });
    rangeCache.purgeCache.mockImplementation(async () => {
      operations.push("range");
      return true;
    });

    const response = await processPurgeRequest(
      new Request("https://example.com/purge/abcde", {
        headers: { Authorization: "Bearer purge-secret" },
      }),
      cacheEnv,
      blobCache,
      rangeCache,
    );

    expect(response.status).toBe(204);
    expect(blobCache.purgeCache).toHaveBeenCalledWith("pwnedpasswords-ABCDE");
    expect(rangeCache.purgeCache).toHaveBeenCalledWith("pwnedpasswords-ABCDE");
    expect(operations).toEqual(["blob", "range"]);
  });

  it.each([
    ["/purge/ABCD", "Bearer purge-secret"],
    ["/purge/ABCDEG", "Bearer purge-secret"],
    ["/purge/ABCDE", null],
    ["/purge/ABCDE", "Basic purge-secret"],
    ["/purge/ABCDE", "Bearer invalid-secret"],
  ])("rejects invalid purge requests", async (path, authorization) => {
    const blobCache = createCachePurger();
    const rangeCache = createCachePurger();
    const headers = authorization ? { Authorization: authorization } : undefined;
    const response = await processPurgeRequest(new Request(`https://example.com${path}`, { headers }), cacheEnv, blobCache, rangeCache);

    expect(response.status).toBe(path === "/purge/ABCD" || path === "/purge/ABCDEG" ? 400 : 403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(blobCache.purgeCache).not.toHaveBeenCalled();
    expect(rangeCache.purgeCache).not.toHaveBeenCalled();
  });

  it("rejects non-GET purge requests", async () => {
    const response = await processPurgeRequest(
      new Request("https://example.com/purge/", {
        method: "POST",
        headers: { Authorization: "Bearer purge-secret" },
      }),
      cacheEnv,
      createCachePurger(),
      createCachePurger(),
    );

    expect(response.status).toBe(405);
  });

  it("does not purge the range cache when Blob cache purging fails", async () => {
    const blobCache = createCachePurger(false);
    const rangeCache = createCachePurger();

    const response = await processPurgeRequest(
      new Request("https://example.com/purge/", {
        headers: { Authorization: "Bearer purge-secret" },
      }),
      cacheEnv,
      blobCache,
      rangeCache,
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Unable to purge Blob cache");
    expect(rangeCache.purgeCache).not.toHaveBeenCalled();
  });

  it("reports a range-cache purge failure after purging Blob cache", async () => {
    const blobCache = createCachePurger();
    const rangeCache = createCachePurger(false);

    const response = await processPurgeRequest(
      new Request("https://example.com/purge/", {
        headers: { Authorization: "Bearer purge-secret" },
      }),
      cacheEnv,
      blobCache,
      rangeCache,
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Unable to purge cache");
    expect(blobCache.purgeCache).toHaveBeenCalledOnce();
  });
});
