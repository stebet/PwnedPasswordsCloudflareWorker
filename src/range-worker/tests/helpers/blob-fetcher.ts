import { vi } from "vitest";

export function createBlobFetcher(response: Response, purgeCacheResult = true) {
  return {
    fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response),
    purgeCache: vi.fn(async () => purgeCacheResult),
  };
}
