# Pwned Passwords Cloudflare Workers

The public API Worker serves Pwned Passwords hash ranges through
`GET /range/{prefix}` and accepts `mode=ntlm` for NTLM ranges. A private Blob Worker
retrieves the range from Azure Blob Storage using Microsoft Entra application
credentials. The public Worker calls it through the `BLOB_FETCHER` service binding;
the Blob Worker has no public route or `workers.dev` endpoint.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/range-worker/` | Public API Worker, its Wrangler configuration, generated bindings, TypeScript project, and tests |
| `src/blob-worker/` | Private Azure Blob Worker, its Wrangler configuration, generated bindings, TypeScript project, and tests |
| `tsconfig.base.json` | Shared TypeScript compiler options used by both Workers |

## Azure Blob configuration

Each range is stored at the root of its configured container as `{PREFIX}.txt`, where
`PREFIX` is the validated, uppercase five-character hash prefix. The Worker maps the
default SHA-1 mode and `mode=ntlm` to separate configured containers. These bindings
belong only to the private Blob Worker:

| Binding | Purpose |
| --- | --- |
| `AZURE_STORAGE_ACCOUNT` | Azure Storage account name |
| `SHA1_BLOB_CONTAINER` | Container holding SHA-1 range blobs |
| `NTLM_BLOB_CONTAINER` | Container holding NTLM range blobs |
| `AZURE_TENANT_ID` | Microsoft Entra tenant (directory) ID |
| `AZURE_CLIENT_ID` | Microsoft Entra application (client) ID |
| `AZURE_CLIENT_SECRET` | Microsoft Entra application client secret |

The public range Worker has a separate `HIBP_PURGE_CACHE_SECRET` secret for
`hibp-purge-cache` cache purge requests.

Store every Azure binding as a private Blob Worker secret:

```sh
for environment in stage prod; do
  for secret in AZURE_STORAGE_ACCOUNT AZURE_CLIENT_ID AZURE_TENANT_ID SHA1_BLOB_CONTAINER NTLM_BLOB_CONTAINER AZURE_CLIENT_SECRET; do
    pnpm exec wrangler secret put "$secret" --config src/blob-worker/wrangler.jsonc --env "$environment"
  done
done
pnpm exec wrangler secret put HIBP_PURGE_CACHE_SECRET --config src/range-worker/wrangler.jsonc --env stage
pnpm exec wrangler secret put HIBP_PURGE_CACHE_SECRET --config src/range-worker/wrangler.jsonc --env prod
```

Assign the application's service principal the **Storage Blob Data Reader** Azure RBAC
role on the storage account or both configured containers. For local development, copy
`.dev.vars.example` to `.dev.vars`, fill in development-only values, and keep that file
untracked.

## Responses

The private Blob Worker uses the OAuth 2.0 client-credentials flow to fetch and cache a
Microsoft Entra access token with the Workers `fetch` API. The public Worker retrieves a
range through its private HTTP service binding, streams the Blob content, and exposes the
Base64 `Content-MD5` checksum persisted by AzCopy to browser clients. The Blob Worker
uses Workers Cache and returns successful Blob responses with their Azure `Content-Length`,
AzCopy `Content-MD5`, `Cache-Tag: pwnedpasswords`, and a one-year `Cache-Control` header.
Its Azure origin requests use the `pwnedpasswords` Cache Tag, one-year CDN TTL, and Cache
Reserve eligibility without a custom cache key. The range Worker caches successful responses
for one month.
`Add-Padding: true` appends the padding
suffix, then omits `Content-MD5` and `Content-Length` because those headers would no
longer describe the transformed body. Responses without an `Add-Padding` header are
cached for one month. Any request containing that header returns `Cache-Control: no-store`;
all responses include `Vary: Add-Padding, HIBP-Purge-Cache`.

Send `HIBP_PURGE_CACHE_SECRET` in the `hibp-purge-cache` request header to purge the
range and Blob Workers' entire caches. Purge requests are not cached.

Transient Blob failures (408, 429, and 5xx responses) and transport errors are retried
up to five times. The Worker honors `Retry-After` when supplied; otherwise it waits one
second initially, then doubles the previous delay with jitter.

## Deployment environments

| Environment | Public API Worker | Private Blob Worker | Public route |
| --- | --- | --- | --- |
| `stage` | `pwnedpasswordsworkerstage` | `pwnedpasswordsblobworkerstage` | `stage-api.pwnedpasswords.com/*` |
| `prod` | `pwnedpasswordsworker` | `pwnedpasswordsblobworker` | `api.pwnedpasswords.com/*` |

Pushing to `main` deploys the `stage` environment. The GitHub Actions **Deploy Worker**
workflow can be manually dispatched to select either `stage` or `prod`. Configure the
six Azure secrets separately for both private Worker environments. Each deployment creates
or updates the private Blob Worker first, then the public API Worker that binds to it.

For CI deployments, add `AZURE_STORAGE_ACCOUNT`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`SHA1_BLOB_CONTAINER`, `NTLM_BLOB_CONTAINER`, and `AZURE_CLIENT_SECRET` as GitHub
Environment secrets for both `stage` and `prod`; the workflow uploads them only to the
private Blob Worker before deployment.

## Commands

```sh
pnpm dev # public API plus private Blob Worker through the local service binding
pnpm dev:blob # private Blob Worker only
pnpm build
pnpm test
pnpm typecheck
pnpm types
pnpm deploy # stage: private Blob Worker, then public API Worker
pnpm deploy:prod # production: private Blob Worker, then public API Worker
```
