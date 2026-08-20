import { WorkerEntrypoint } from "cloudflare:workers";
import { cacheTagForPrefix } from "./cache-tags";

const validHex = /^[0-9A-F]{5}$/;
const textEncoder = new TextEncoder();

interface CachePurger {
  purgeCache(tag?: string): PromiseLike<boolean>;
}

export class PurgeEntrypoint extends WorkerEntrypoint<ApiEnv> {
  public async fetch(request: Request): Promise<Response> {
    return await processPurgeRequest(request, this.env, this.env.BLOB_ENTRYPOINT, this.env.RANGE_ENTRYPOINT);
  }
}

export async function processPurgeRequest(
  request: Request,
  env: Pick<ApiEnv, "HIBP_PURGE_CACHE_SECRET">,
  blobCache: CachePurger,
  rangeCache: CachePurger,
): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (request.method !== "GET") {
    return new Response("Only GET requests can be used to purge ranges", {
      status: 405,
      statusText: "Method Not Allowed",
      headers,
    });
  }

  if (!(await hasValidPurgeAuthorization(request, env.HIBP_PURGE_CACHE_SECRET))) {
    return new Response("Invalid cache purge secret", { status: 403, statusText: "Forbidden", headers });
  }

  const tag = getPurgeTag(new URL(request.url).pathname);
  if (tag === null) {
    return new Response("The hash prefix was not in a valid format", { status: 400, statusText: "Bad Request", headers });
  }

  if (!(await blobCache.purgeCache(tag))) {
    return new Response("Unable to purge Blob cache", { status: 502, statusText: "Bad Gateway", headers });
  }

  if (!(await rangeCache.purgeCache(tag))) {
    return new Response("Unable to purge cache", { status: 502, statusText: "Bad Gateway", headers });
  }

  return new Response(null, { status: 204, statusText: "No Content", headers });
}

async function hasValidPurgeAuthorization(request: Request, expectedSecret: string): Promise<boolean> {
  const authorization = request.headers.get("Authorization");
  const providedSecret = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!providedSecret) {
    return false;
  }

  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(providedSecret)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(expectedSecret)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

function getPurgeTag(pathname: string): string | undefined | null {
  if (pathname === "/purge" || pathname === "/purge/") {
    return undefined;
  }

  const prefix = pathname.substring("/purge/".length).toUpperCase();
  if (prefix.length !== 5 || !validHex.test(prefix)) {
    return null;
  }

  return cacheTagForPrefix(prefix);
}
