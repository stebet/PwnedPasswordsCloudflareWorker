import { describe, expect, it, vi } from "vitest";
import * as worker from "../index";
import { createBlobFetcher } from "./helpers/blob-fetcher";

// We want deterministic padding line counts.
vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return {
    ...original,
    randomInt: vi.fn(() => 10),
  };
});

describe("Add-Padding suffix formatting", () => {
  it("pads SHA1 mode with 35-hex suffixes", async () => {
    const blobFetcher = createBlobFetcher(new Response("BODY"));
    const grvSpy = vi.spyOn(crypto, "getRandomValues").mockImplementation(((arr: Uint8Array) => {
      // all zeros => hex string is fully padded with leading zeros
      arr.fill(0);
      return arr;
    }) as typeof crypto.getRandomValues);

    const response = await worker.processRangeRequest(
      new Request("https://example.com/range/ABCDE", {
        headers: {
          "Add-Padding": "true",
        },
      }),
      blobFetcher,
    );
    const text = await response.text();

    expect(text).toMatch(/^BODY\r\n/);
    expect(text.indexOf("BODY")).toBe(0);
    expect(text.lastIndexOf("BODY")).toBe(0);

    // BODY is followed by 10 padding lines each beginning with CRLF.
    const parts = text.split("\r\n");
    expect(parts[0]).toBe("BODY");

    const paddingLines = parts.slice(1).filter((p) => p.length > 0);
    expect(paddingLines).toHaveLength(10);

    for (const line of paddingLines) {
      expect(line).toMatch(/^[0-9A-F]{35}:0$/);
    }

    grvSpy.mockRestore();
  });

  it("pads NTLM mode with 27-hex suffixes", async () => {
    const blobFetcher = createBlobFetcher(new Response("BODY"));
    const grvSpy = vi.spyOn(crypto, "getRandomValues").mockImplementation(((arr: Uint8Array) => {
      // deterministic bytes that start with 0x00 ensures leading zeroes must be preserved.
      arr.fill(0);
      arr[0] = 0;
      arr[1] = 1;
      return arr;
    }) as typeof crypto.getRandomValues);

    const response = await worker.processRangeRequest(
      new Request("https://example.com/range/ABCDE?mode=ntlm", {
        headers: {
          "Add-Padding": "true",
        },
      }),
      blobFetcher,
    );
    const text = await response.text();

    expect(text).toMatch(/^BODY\r\n/);
    expect(text.indexOf("BODY")).toBe(0);
    expect(text.lastIndexOf("BODY")).toBe(0);

    const parts = text.split("\r\n");
    expect(parts[0]).toBe("BODY");

    const paddingLines = parts.slice(1).filter((p) => p.length > 0);
    expect(paddingLines).toHaveLength(10);

    for (const line of paddingLines) {
      expect(line).toMatch(/^[0-9A-F]{27}:0$/);
    }

    grvSpy.mockRestore();
  });
});
