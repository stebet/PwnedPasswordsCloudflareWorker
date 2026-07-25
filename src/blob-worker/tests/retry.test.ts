import { describe, expect, it } from "vitest";
import { fetchWithRetry } from "../retry";

describe("fetchWithRetry", () => {
  it("retries transient responses with exponential backoff", async () => {
    const responses = [new Response("", { status: 500 }), new Response("", { status: 503 }), new Response("ok")];
    const waits: number[] = [];
    let attempts = 0;

    const response = await fetchWithRetry("https://example.com", undefined, {
      fetch: async () => {
        attempts++;
        return responses.shift() as Response;
      },
      random: () => 0.5,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    expect(await response.text()).toBe("ok");
    expect(attempts).toBe(3);
    expect(waits).toEqual([1_000, 2_000]);
  });

  it("makes five retries before accepting a sixth response", async () => {
    const waits: number[] = [];
    let attempts = 0;

    const response = await fetchWithRetry("https://example.com", undefined, {
      fetch: async () => {
        attempts++;
        return attempts === 6 ? new Response("ok") : new Response("", { status: 500 });
      },
      random: () => 0.5,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    expect(await response.text()).toBe("ok");
    expect(attempts).toBe(6);
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
  });

  it("honors Retry-After before retrying", async () => {
    const waits: number[] = [];
    let attempts = 0;

    const response = await fetchWithRetry("https://example.com", undefined, {
      fetch: async () => {
        attempts++;
        return attempts === 1 ? new Response("", { status: 429, headers: { "Retry-After": "3" } }) : new Response("ok");
      },
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    expect(await response.text()).toBe("ok");
    expect(waits).toEqual([3_000]);
  });

  it("retries transport failures", async () => {
    const waits: number[] = [];
    let attempts = 0;

    const response = await fetchWithRetry("https://example.com", undefined, {
      fetch: async () => {
        attempts++;
        if (attempts === 1) {
          throw new TypeError("network failure");
        }

        return new Response("ok");
      },
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    expect(await response.text()).toBe("ok");
    expect(waits).toEqual([1_000]);
  });

  it("returns permanent failures without retrying", async () => {
    let attempts = 0;

    const response = await fetchWithRetry("https://example.com", undefined, {
      fetch: async () => {
        attempts++;
        return new Response("not found", { status: 404 });
      },
      sleep: async () => {
        throw new Error("Permanent responses should not be retried");
      },
    });

    expect(response.status).toBe(404);
    expect(attempts).toBe(1);
  });
});
