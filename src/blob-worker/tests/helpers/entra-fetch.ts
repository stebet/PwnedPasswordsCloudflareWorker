import { vi } from "vitest";

export function mockEntraAndBlobFetch(blobResponse: Response) {
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
