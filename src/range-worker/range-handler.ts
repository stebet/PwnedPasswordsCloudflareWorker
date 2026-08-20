import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import { cacheTagForPrefix } from "./cache-tags";

const validHex = /^[0-9A-F]{5}$/;

interface BlobFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export async function processRangeRequest(request: Request, blobFetcher: BlobFetcher): Promise<Response> {
  const headers = createRangeResponseHeaders();
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET");
    headers.set("Access-Control-Allow-Headers", "Add-Padding");
    headers.set("Access-Control-Max-Age", "1728000");
    return new Response("", { headers });
  }

  const url = new URL(request.url);
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
  if (prefix.length !== 5) {
    return new Response("The hash prefix was not in a valid format", { status: 400, statusText: "Bad Request", headers });
  }

  if (!validHex.test(prefix)) {
    return new Response("The hash prefix was not valid hexadecimal", { status: 400, statusText: "Bad Request", headers });
  }

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Expose-Headers", "Content-MD5, ETag");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  const blobUrl = new URL(`https://blob-entrypoint.internal/range/${prefix}`);
  if (isNtlm) {
    blobUrl.searchParams.set("mode", "ntlm");
  }

  const blobResponse = await blobFetcher.fetch(new Request(blobUrl));
  copyIntegrityHeaders(blobResponse.headers, headers);

  const addPaddingHeader = request.headers.get("Add-Padding");
  if (blobResponse.status === 200) {
    setCacheHeadersForSuccessfulBlobResponse(headers, addPaddingHeader, prefix);
  }

  if (blobResponse.status === 200 && addPaddingHeader?.toLowerCase() === "true") {
    const content = await blobResponse.text();
    if (!content) {
      headers.delete("Content-MD5");
      headers.delete("ETag");
      headers.delete("Content-Length");
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

function createRangeResponseHeaders(): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Add-Padding");
  return headers;
}

function copyIntegrityHeaders(source: Headers, target: Headers): void {
  const md5 = source.get("Content-MD5");
  if (md5) {
    target.set("Content-MD5", md5);
  }

  const etag = source.get("ETag");
  if (etag) {
    target.set("ETag", etag);
  }
}

function setCacheHeadersForSuccessfulBlobResponse(headers: Headers, addPaddingHeader: string | null, prefix: string): void {
  if (addPaddingHeader) {
    return;
  }

  headers.set("Cache-Control", "public, max-age=2678400");
  headers.set("Cache-Tag", cacheTagForPrefix(prefix));
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
