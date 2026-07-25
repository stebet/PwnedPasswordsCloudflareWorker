import { WorkerEntrypoint } from "cloudflare:workers";
import { AzureClientSecretCredential } from "./azure-client-secret-credential";
import { fetchWithRetry } from "./retry";

const validHex = /^[0-9A-F]{5}$/;
const blobCacheTtl = 31_536_000;
const blobCacheControl = `public, max-age=${blobCacheTtl}`;
const blobCacheTag = "pwnedpasswords";
let credential: AzureClientSecretCredential | undefined;

export default class BlobWorker extends WorkerEntrypoint<BlobEnv> {
  public async fetch(request: Request): Promise<Response> {
    return await processRequest(request, this.env);
  }

  public async purgeCache(): Promise<boolean> {
    return await purgeWorkerCache(this.ctx);
  }
}

export async function processRequest(request: Request, env: BlobEnv): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Only GET requests can be used to query ranges", {
      status: 405,
      statusText: "Method Not Allowed",
    });
  }

  const url = new URL(request.url);
  if (!url.pathname.startsWith("/range/")) {
    return new Response("Invalid Blob request", { status: 400, statusText: "Bad Request" });
  }

  const prefix = url.pathname.substring(7).toUpperCase();
  if (prefix.length !== 5 || !validHex.test(prefix)) {
    return new Response("The hash prefix was not in a valid format", { status: 400, statusText: "Bad Request" });
  }

  const container = url.searchParams.get("mode") === "ntlm" ? env.NTLM_BLOB_CONTAINER : env.SHA1_BLOB_CONTAINER;
  const blobResponse = await downloadBlob(env, container, `${prefix}.txt`);
  const headers = new Headers(blobResponse.headers);
  headers.set("Cache-Control", blobResponse.ok ? blobCacheControl : "no-store");
  if (blobResponse.ok) {
    headers.set("Cache-Tag", blobCacheTag);
  } else {
    headers.delete("Cache-Tag");
  }

  return new Response(blobResponse.body, {
    status: blobResponse.status,
    statusText: blobResponse.statusText,
    headers,
  });
}

async function downloadBlob(env: BlobEnv, container: string, blobName: string): Promise<Response> {
  const accessToken = await getCredential(env).getToken("https://storage.azure.com/.default");
  const blobUrl = `https://${env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net/${container}/${blobName}`;

  return await fetchWithRetry(blobUrl, {
    headers: {
      Authorization: `Bearer ${accessToken.token}`,
      "x-ms-version": "2023-11-03",
    },
    cf: {
      cacheEverything: true,
      cacheTags: [blobCacheTag],
      cacheControl: blobCacheControl,
      cacheReserveEligible: true,
      cacheTtlByStatus: {
        "200-299": blobCacheTtl,
        "300-599": -1,
      },
    },
  });
}

export async function purgeWorkerCache(ctx: Pick<ExecutionContext, "cache">): Promise<boolean> {
  const cache = ctx.cache;
  return cache ? (await cache.purge({ purgeEverything: true })).success : false;
}

function getCredential(env: BlobEnv): AzureClientSecretCredential {
  if (!credential) {
    credential = new AzureClientSecretCredential(env.AZURE_TENANT_ID, env.AZURE_CLIENT_ID, env.AZURE_CLIENT_SECRET);
  }

  return credential;
}
