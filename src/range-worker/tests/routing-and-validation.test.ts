import { describe, expect, it } from "vitest";
import * as worker from "../index";
import { createBlobFetcher } from "./helpers/blob-fetcher";

describe("request routing and protocol handling", () => {
  it("handles CORS preflight OPTIONS", async () => {
    const response = await worker.processRangeRequest(
      new Request("https://example.com/range/ABCDE", {
        method: "OPTIONS",
      }),
      createBlobFetcher(new Response("unexpected")),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Add-Padding");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("1728000");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toBe("Add-Padding");
  });

  it("accepts HTTP range requests", async () => {
    const response = await worker.processRangeRequest(
      new Request("http://example.com/range/ABCDE"),
      createBlobFetcher(new Response("unexpected")),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("unexpected");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=2678400");
    expect(response.headers.get("Vary")).toBe("Add-Padding");
    expect(response.headers.get("Cache-Tag")).toBe("pwnedpasswords-ABCDE");
  });

  it("ignores the retired cache purge header on range requests", async () => {
    const response = await worker.processRangeRequest(
      new Request("https://example.com/range/ABCDE", {
        headers: { "hibp-purge-cache": "retired-secret" },
      }),
      createBlobFetcher(new Response("unexpected")),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=2678400");
    expect(response.headers.get("Vary")).toBe("Add-Padding");
  });

  it("rejects invalid API paths", async () => {
    const response = await worker.processRangeRequest(
      new Request("https://example.com/not-range/ABCDE"),
      createBlobFetcher(new Response("unexpected")),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Invalid API query");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects non-GET methods to /range", async () => {
    const response = await worker.processRangeRequest(
      new Request("https://example.com/range/ABCDE", {
        method: "POST",
      }),
      createBlobFetcher(new Response("unexpected")),
    );

    expect(response.status).toBe(405);
    expect(await response.text()).toContain("POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
