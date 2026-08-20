import { cache } from "cloudflare:workers";

type CachePurgeContext = {
  cache?: Partial<Pick<CacheContext, "purge">>;
};

export async function purgeWorkerCache(tag?: string, context?: CachePurgeContext): Promise<boolean> {
  const cacheContext = context?.cache ?? cache;
  if (typeof cacheContext.purge !== "function") {
    console.warn(JSON.stringify({ message: "Cache purge is unavailable in this runtime; skipping local cache invalidation" }));
    return true;
  }

  const result = await cacheContext.purge(tag ? { tags: [tag] } : { purgeEverything: true });
  if (!result.success) {
    console.error(JSON.stringify({ message: "Cache purge failed", errors: result.errors }));
  }

  return result.success;
}
