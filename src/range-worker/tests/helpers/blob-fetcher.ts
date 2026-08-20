import { vi } from "vitest";

export function createBlobFetcher(response: Response) {
  return {
    fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response),
  };
}
