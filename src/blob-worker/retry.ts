import { setTimeout } from "node:timers/promises";

const initialRetryDelayMs = 1_000;
const maxRetries = 5;

export interface FetchWithRetryOptions {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, options: FetchWithRetryOptions = {}): Promise<Response> {
  const request = options.fetch ?? fetch;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? setTimeout;
  let previousDelayMs = initialRetryDelayMs;

  for (let retry = 0; ; retry++) {
    let response: Response;
    try {
      response = await request(input, init);
    } catch (error) {
      if (retry === maxRetries) {
        throw error;
      }

      const retryDelayMs = getRetryDelayMs(null, retry, previousDelayMs, random);
      previousDelayMs = retryDelayMs;
      await sleep(retryDelayMs);
      continue;
    }

    if (!isRetryableStatus(response.status) || retry === maxRetries) {
      return response;
    }

    const retryDelayMs = getRetryDelayMs(response.headers.get("Retry-After"), retry, previousDelayMs, random);
    previousDelayMs = retryDelayMs;
    await response.body?.cancel();
    await sleep(retryDelayMs);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function getRetryDelayMs(retryAfter: string | null, retry: number, previousDelayMs: number, random: () => number): number {
  const retryAfterDelayMs = parseRetryAfter(retryAfter);
  if (retryAfterDelayMs !== undefined) {
    return retryAfterDelayMs;
  }

  if (retry === 0) {
    return initialRetryDelayMs;
  }

  const jitter = 0.8 + random() * 0.4;
  return Math.round(previousDelayMs * 2 * jitter);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }

  return Math.max(0, dateMs - Date.now());
}
