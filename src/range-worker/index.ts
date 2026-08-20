import { WorkerEntrypoint } from "cloudflare:workers";
import { purgeWorkerCache } from "./cache-purge";
import { processRangeRequest } from "./range-handler";

export default class RangeEntrypoint extends WorkerEntrypoint<ApiEnv> {
  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/purge" || url.pathname.startsWith("/purge/")) {
      return await this.env.PURGE_ENTRYPOINT.fetch(request);
    }

    return await processRangeRequest(request, this.env.BLOB_ENTRYPOINT);
  }

  public async purgeCache(tag?: string): Promise<boolean> {
    return await purgeWorkerCache(tag);
  }
}

export { BlobEntrypoint } from "./blob-entrypoint";
export { PurgeEntrypoint, processPurgeRequest } from "./purge-entrypoint";
export { processRangeRequest } from "./range-handler";
