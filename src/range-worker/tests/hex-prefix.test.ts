import { describe, expect, it } from "vitest";
import * as worker from "../index";
import { createBlobFetcher } from "./helpers/blob-fetcher";

describe("/range/{prefix} validation", () => {
  it("rejects a wrong-length prefix", async () => {
    const response = await worker.processRequest(
      new Request("https://example.com/range/ABCD"),
      createBlobFetcher(new Response("unexpected")),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("valid format");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects a non-hex prefix", async () => {
    const response = await worker.processRequest(
      new Request("https://example.com/range/ABCDG"),
      createBlobFetcher(new Response("unexpected")),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("valid hexadecimal");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("accepts a valid 5-char hex prefix", async () => {
    const response = await worker.processRequest(new Request("https://example.com/range/ABCDE"), createBlobFetcher(new Response("OK")));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });
});
