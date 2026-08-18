import { describe, expect, it } from "vitest";
import * as worker from "../index";
import { createBlobFetcher } from "./helpers/blob-fetcher";

describe("Add-Padding when upstream has no body", () => {
  it("returns 500 when upstream body is empty", async () => {
    const response = await worker.processRequest(
      new Request("https://example.com/range/ABCDE", {
        headers: {
          "Add-Padding": "true",
        },
      }),
      createBlobFetcher(new Response(null)),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("Upstream response body was empty");
  });

  it("preserves CORS headers without stale integrity validators on an empty Blob response", async () => {
    const response = await worker.processRequest(
      new Request("https://example.com/range/ABCDE", {
        headers: {
          "Add-Padding": "true",
        },
      }),
      createBlobFetcher(
        new Response(null, {
          headers: {
            "Content-Length": "0",
            "Content-MD5": "RkFLRS1NRDU=",
            ETag: '"blob-version"',
          },
        }),
      ),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("Content-MD5")).toBeNull();
    expect(response.headers.get("ETag")).toBeNull();
    expect(await response.text()).toContain("Upstream response body was empty");
  });
});
