import { describe, expect, it, vi } from "vitest";
import { processRequest } from "../index";
import { createBlobFetcher } from "./helpers/blob-fetcher";

const cacheEnv = {
  HIBP_PURGE_CACHE_SECRET: "purge-secret",
};

function createCacheContext(success = true) {
  return {
    cache: {
      purge: vi.fn(async () => ({ errors: [], success })),
    },
  };
}

describe("Blob service binding", () => {
  it("forwards a SHA-1 range request and preserves upstream integrity headers", async () => {
    const blobFetcher = createBlobFetcher(
      new Response("RANGE-DATA", {
        headers: {
          Age: "300",
          "CF-Cache-Status": "HIT",
          "Content-MD5": "RkFLRS1NRDU=",
          ETag: '"blob-version"',
        },
      }),
    );
    const cacheContext = createCacheContext();

    const response = await processRequest(
      new Request("https://example.com/range/ABCDE", {
        headers: {
          Authorization: "Bearer client-token",
        },
      }),
      blobFetcher,
      cacheEnv,
      cacheContext,
    );

    expect(await response.text()).toBe("RANGE-DATA");
    expect(response.headers.get("Content-MD5")).toBe("RkFLRS1NRDU=");
    expect(response.headers.get("ETag")).toBe('"blob-version"');
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("Content-MD5, ETag");
    expect(response.headers.get("CF-Cache-Status")).toBeNull();
    expect(response.headers.get("Age")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=2678400");
    expect(response.headers.get("Cache-Tag")).toBeNull();
    expect(response.headers.get("Vary")).toBe("add-padding, hibp-purge-cache");

    const [request, init] = blobFetcher.fetch.mock.calls[0];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).url).toBe("https://blob-fetcher.internal/range/ABCDE");
    expect(init).toBeUndefined();
    expect(cacheContext.cache.purge).not.toHaveBeenCalled();
  });

  it.each([
    [404, "Not Found", "Range does not exist"],
    [500, "Internal Server Error", "Blob service failed"],
  ])("does not cache a %i Blob response", async (status, statusText, body) => {
    const response = await processRequest(
      new Request("https://example.com/range/ABCDE"),
      createBlobFetcher(new Response(body, { status, statusText })),
    );

    expect(response.status).toBe(status);
    expect(response.statusText).toBe(statusText);
    expect(await response.text()).toBe(body);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("includes NTLM mode in the Blob service request", async () => {
    const blobFetcher = createBlobFetcher(new Response("RANGE-DATA"));

    const response = await processRequest(
      new Request("https://example.com/range/ABCDE?mode=ntlm", {
        headers: { "Add-Padding": "false" },
      }),
      blobFetcher,
    );

    const [request] = blobFetcher.fetch.mock.calls[0];
    expect((request as Request).url).toBe("https://blob-fetcher.internal/range/ABCDE?mode=ntlm");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toBe("add-padding, hibp-purge-cache");
  });

  it("removes checksum headers after padding changes the body", async () => {
    const response = await processRequest(
      new Request("https://example.com/range/ABCDE", {
        headers: { "Add-Padding": "true" },
      }),
      createBlobFetcher(
        new Response("RANGE-DATA", {
          headers: {
            Age: "0",
            "CF-Cache-Status": "MISS",
            "Content-MD5": "RkFLRS1NRDU=",
            ETag: '"blob-version"',
          },
        }),
      ),
    );

    expect(response.headers.get("Content-MD5")).toBeNull();
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toBe("add-padding, hibp-purge-cache");
    expect(response.headers.get("CF-Cache-Status")).toBeNull();
    expect(response.headers.get("Age")).toBeNull();
  });

  it("purges the Blob cache before the final range-cache invalidation", async () => {
    const operations: string[] = [];
    const blobFetcher = createBlobFetcher(new Response("RANGE-DATA"));
    blobFetcher.purgeCache.mockImplementation(async () => {
      operations.push("blob");
      return true;
    });
    const cacheContext = {
      cache: {
        purge: vi.fn(async () => {
          operations.push("range");
          return { errors: [], success: true };
        }),
      },
    };
    const response = await processRequest(
      new Request("https://example.com/range/ABCDE", {
        headers: { "hibp-purge-cache": "purge-secret" },
      }),
      blobFetcher,
      cacheEnv,
      cacheContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(cacheContext.cache.purge).toHaveBeenCalledWith({ purgeEverything: true });
    expect(blobFetcher.purgeCache).toHaveBeenCalledOnce();
    expect(operations).toEqual(["blob", "range"]);
    const [blobRequest] = blobFetcher.fetch.mock.calls[0];
    expect((blobRequest as Request).headers.get("hibp-purge-cache")).toBeNull();
  });

  it("rejects an unauthorized purge request without calling the Blob Worker", async () => {
    const blobFetcher = createBlobFetcher(new Response("RANGE-DATA"));
    const cacheContext = createCacheContext();
    const response = await processRequest(
      new Request("https://example.com/range/ABCDE", {
        headers: { "hibp-purge-cache": "invalid-secret" },
      }),
      blobFetcher,
      cacheEnv,
      cacheContext,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(cacheContext.cache.purge).not.toHaveBeenCalled();
    expect(blobFetcher.purgeCache).not.toHaveBeenCalled();
    expect(blobFetcher.fetch).not.toHaveBeenCalled();
  });

  it("returns 502 when the Blob Worker cache cannot be purged", async () => {
    const blobFetcher = createBlobFetcher(new Response("RANGE-DATA"), false);
    const cacheContext = createCacheContext();
    const response = await processRequest(
      new Request("https://example.com/range/ABCDE", {
        headers: { "hibp-purge-cache": "purge-secret" },
      }),
      blobFetcher,
      cacheEnv,
      cacheContext,
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Unable to purge Blob cache");
    expect(cacheContext.cache.purge).not.toHaveBeenCalled();
    expect(blobFetcher.purgeCache).toHaveBeenCalledOnce();
    expect(blobFetcher.fetch).not.toHaveBeenCalled();
  });
});
