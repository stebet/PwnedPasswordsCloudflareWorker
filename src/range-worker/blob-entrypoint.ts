import { WorkerEntrypoint } from "cloudflare:workers";
import { AzureClientSecretCredential } from "./azure-client-secret-credential";
import { purgeWorkerCache } from "./cache-purge";
import { cacheTagForPrefix } from "./cache-tags";
import { fetchWithRetry } from "./retry";

const validHex = /^[0-9A-F]{5}$/;
const blobCacheTtl = 31_536_000;
const blobCacheControl = `public, max-age=${blobCacheTtl}`;
let credential: AzureClientSecretCredential | undefined;

type AzureBlobEnv = Pick<
  ApiEnv,
  "AZURE_STORAGE_ACCOUNT" | "AZURE_CLIENT_ID" | "AZURE_TENANT_ID" | "SHA1_BLOB_CONTAINER" | "NTLM_BLOB_CONTAINER" | "AZURE_CLIENT_SECRET"
>;

export class BlobEntrypoint extends WorkerEntrypoint<ApiEnv> {
  public async fetch(request: Request): Promise<Response> {
    return await processBlobRequest(request, this.env);
  }

  public async purgeCache(tag?: string): Promise<boolean> {
    return await purgeWorkerCache(tag);
  }
}

export async function processBlobRequest(request: Request, env: AzureBlobEnv): Promise<Response> {
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
  const cacheTag = cacheTagForPrefix(prefix);
  const blobResponse = await downloadBlob(env, container, `${prefix}.txt`, cacheTag);
  const headers = new Headers(blobResponse.headers);
  headers.set("Cache-Control", blobResponse.ok ? blobCacheControl : "no-store");
  if (blobResponse.ok) {
    headers.set("Cache-Tag", cacheTag);
  } else {
    headers.delete("Cache-Tag");
  }

  return new Response(blobResponse.body, {
    status: blobResponse.status,
    statusText: blobResponse.statusText,
    headers,
  });
}

async function downloadBlob(env: AzureBlobEnv, container: string, blobName: string, cacheTag: string): Promise<Response> {
  const accessToken = await getCredential(env).getToken("https://storage.azure.com/.default");
  const blobUrl = `https://${env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net/${container}/${blobName}`;

  return await fetchWithRetry(blobUrl, {
    headers: {
      Authorization: `Bearer ${accessToken.token}`,
      "x-ms-version": "2023-11-03",
    },
    cf: {
      cacheEverything: true,
      cacheTags: [cacheTag],
      cacheControl: blobCacheControl,
      cacheReserveEligible: true,
      cacheTtlByStatus: {
        "200-299": blobCacheTtl,
        "300-599": -1,
      },
    },
  });
}

function getCredential(env: AzureBlobEnv): AzureClientSecretCredential {
  if (!credential) {
    credential = new AzureClientSecretCredential(env.AZURE_TENANT_ID, env.AZURE_CLIENT_ID, env.AZURE_CLIENT_SECRET);
  }

  return credential;
}
