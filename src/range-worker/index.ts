import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";

const validHex = /^[0-9A-F]{5}$/;
const cachePurgeHeader = "hibp-purge-cache";
const textEncoder = new TextEncoder();

interface BlobFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  purgeCache(): PromiseLike<boolean>;
}
type CachePurgeContext = Pick<ExecutionContext, "cache">;
type CachePurgeEnvironment = Pick<ApiEnv, "HIBP_PURGE_CACHE_SECRET">;

export default {
  async fetch(request: Request, env: ApiEnv, ctx: ExecutionContext): Promise<Response> {
    return await processRequest(request, env.BLOB_FETCHER, env, ctx);
  },
} satisfies ExportedHandler<ApiEnv>;

export async function processRequest(
  request: Request,
  blobFetcher: BlobFetcher,
  env?: CachePurgeEnvironment,
  ctx?: CachePurgeContext,
): Promise<Response> {
  const headers = createResponseHeaders();
  if (env && ctx) {
    const purgeOutcome = await purgeCacheIfAuthorized(request, env.HIBP_PURGE_CACHE_SECRET, ctx);
    if (purgeOutcome === "unauthorized") {
      return new Response("Invalid cache purge secret", { status: 403, statusText: "Forbidden", headers });
    }

    if (purgeOutcome === "failed") {
      return new Response("Unable to purge cache", { status: 502, statusText: "Bad Gateway", headers });
    }

    if (purgeOutcome === "purged" && !(await blobFetcher.purgeCache())) {
      return new Response("Unable to purge Blob cache", { status: 502, statusText: "Bad Gateway", headers });
    }
  }

  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET");
    headers.set("Access-Control-Allow-Headers", "Add-Padding");
    headers.set("Access-Control-Max-Age", "1728000");
    return new Response("", { headers });
  }

  const url = new URL(request.url);
  /*
  if (!url.protocol.startsWith("https") && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    return new Response("Requests must be made over HTTPS", { status: 400, statusText: "Bad Request", headers });
  }
  */

  if (!url.pathname.startsWith("/range/")) {
    return new Response("Invalid API query", { status: 400, statusText: "Bad Request", headers });
  }

  if (request.method !== "GET") {
    return new Response(`Only GET requests can be used to query ranges, but this request used the ${request.method} verb`, {
      status: 405,
      statusText: "Method Not Allowed",
      headers,
    });
  }

  const prefix = url.pathname.substring(7).toUpperCase();
  const isNtlm = url.searchParams.get("mode") === "ntlm";
  if (prefix === null || prefix.length !== 5) {
    return new Response("The hash prefix was not in a valid format", { status: 400, statusText: "Bad Request", headers });
  }

  if (validHex.test(prefix) === false) {
    return new Response("The hash prefix was not valid hexadecimal", { status: 400, statusText: "Bad Request", headers });
  }

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Expose-Headers", "Content-MD5, ETag");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  const blobUrl = new URL(`https://blob-fetcher.internal/range/${prefix}`);
  if (isNtlm) {
    blobUrl.searchParams.set("mode", "ntlm");
  }

  const blobResponse = await blobFetcher.fetch(new Request(blobUrl));
  const md5 = blobResponse.headers.get("Content-MD5");
  if (md5) {
    headers.set("Content-MD5", md5);
  }
  const etag = blobResponse.headers.get("ETag");
  if (etag) {
    headers.set("ETag", etag);
  }

  const addPaddingHeader = request.headers.get("Add-Padding");
  if (blobResponse.status === 200) {
    setCacheControlForSuccessfulBlobResponse(headers, request);
  }

  if (blobResponse.status === 200 && addPaddingHeader && addPaddingHeader.toLowerCase() === "true") {
    const content = await blobResponse.text();
    if (!content) {
      return new Response("Upstream response body was empty", {
        status: 500,
        headers,
      });
    }

    const newResponse = new Response(`${content}${buildPaddingSuffix(isNtlm)}`, { headers });
    newResponse.headers.delete("Content-MD5");
    newResponse.headers.delete("ETag");
    newResponse.headers.delete("Content-Length");
    return newResponse;
  }

  return new Response(blobResponse.body, {
    status: blobResponse.status,
    statusText: blobResponse.statusText,
    headers,
  });
}

function createResponseHeaders(): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "add-padding, hibp-purge-cache");
  return headers;
}

function setCacheControlForSuccessfulBlobResponse(headers: Headers, request: Request): void {
  const shouldBypassCache = request.headers.has("Add-Padding") || request.headers.has(cachePurgeHeader);
  if (!shouldBypassCache) {
    headers.set("Cache-Control", "public, max-age=2678400");
  }
}

async function purgeCacheIfAuthorized(
  request: Request,
  expectedSecret: string,
  ctx: CachePurgeContext,
): Promise<"unauthorized" | "purged" | "failed" | "not-requested"> {
  const providedSecret = request.headers.get(cachePurgeHeader);
  if (providedSecret === null) {
    return "not-requested";
  }

  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(providedSecret)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(expectedSecret)),
  ]);
  if (!crypto.subtle.timingSafeEqual(providedHash, expectedHash)) {
    return "unauthorized";
  }

  const cache = ctx.cache;
  if (!cache) {
    return "failed";
  }

  const result = await cache.purge({ purgeEverything: true });
  return result.success ? "purged" : "failed";
}

function buildPaddingSuffix(isNtlm: boolean): string {
  const buffer = Buffer.alloc(isNtlm ? 14 : 18);
  const numRandomLines = randomInt(10, 200);
  const parts = new Array<string>(numRandomLines);

  for (let i = 0; i < numRandomLines; i++) {
    crypto.getRandomValues(buffer);
    parts[i] = `\r\n${buffer.toString("hex").substring(1).toUpperCase()}:0`;
  }

  return parts.join("");
}
