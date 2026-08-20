# Pwned Passwords Cloudflare Worker

This Worker serves Pwned Passwords hash ranges through `GET /range/{prefix}` and accepts
`mode=ntlm` for NTLM ranges. One public Worker contains three entrypoints:

| Entrypoint | Purpose |
| --- | --- |
| `RangeEntrypoint` (default) | Public routing, range responses, padding, and range-response caching |
| `BlobEntrypoint` | Private self-bound Azure Blob retrieval and Blob caching |
| `PurgeEntrypoint` | Private self-bound authenticated cache invalidation |

Only the default entrypoint has public routes. The Blob and purge entrypoints are invoked
through self service bindings, never through a public URL.

## Azure Blob configuration

Each range is stored at the root of its configured container as `{PREFIX}.txt`, where
`PREFIX` is the validated, uppercase five-character hash prefix. SHA-1 and NTLM ranges
use separate containers. Configure these secrets on the single range Worker:

| Binding | Purpose |
| --- | --- |
| `AZURE_STORAGE_ACCOUNT` | Azure Storage account name |
| `SHA1_BLOB_CONTAINER` | Container holding SHA-1 range blobs |
| `NTLM_BLOB_CONTAINER` | Container holding NTLM range blobs |
| `AZURE_TENANT_ID` | Microsoft Entra tenant (directory) ID |
| `AZURE_CLIENT_ID` | Microsoft Entra application (client) ID |
| `AZURE_CLIENT_SECRET` | Microsoft Entra application client secret |
| `HIBP_PURGE_CACHE_SECRET` | Bearer token used by the purge endpoint |

Store every binding as a Worker secret:

```sh
for environment in stage prod; do
  for secret in AZURE_STORAGE_ACCOUNT AZURE_CLIENT_ID AZURE_TENANT_ID SHA1_BLOB_CONTAINER NTLM_BLOB_CONTAINER AZURE_CLIENT_SECRET HIBP_PURGE_CACHE_SECRET; do
    pnpm exec wrangler secret put "$secret" --config src/range-worker/wrangler.jsonc --env "$environment"
  done
done
```

Assign the application's service principal the **Storage Blob Data Reader** Azure RBAC role
on the storage account or both configured containers. For local development, copy
`.dev.vars.example` to `.dev.vars`, fill in development-only values, and keep that file
untracked.

## Responses and caching

The private Blob entrypoint uses the OAuth 2.0 client-credentials flow to fetch and cache
Microsoft Entra access tokens. It streams Blob content, preserves Azure `Content-MD5`, and
caches successful Blob responses for one year. The public range entrypoint exposes the
checksum to clients and caches successful, non-padded range responses for one month.

Both cache layers assign the normalized prefix tag `pwnedpasswords-{PREFIX}` to successful
responses. The tag intentionally omits hash mode, so one prefix purge invalidates the SHA-1
and NTLM variants together. Cloudflare consumes `Cache-Tag` as cache metadata before a
response reaches clients.

`Add-Padding: true` appends the padding suffix and omits `Content-MD5`, `ETag`, and
`Content-Length`, because those headers no longer describe the transformed body. Any request
containing `Add-Padding` is not cached. Range responses vary only by `Add-Padding`.

## Purging caches

Use a GET request with an Authorization bearer token equal to the configured
`HIBP_PURGE_CACHE_SECRET`:

```sh
# Purge every cached range.
curl -H "Authorization: Bearer $HIBP_PURGE_CACHE_SECRET" https://api.pwnedpasswords.com/purge/

# Purge one prefix in both SHA-1 and NTLM caches.
curl -H "Authorization: Bearer $HIBP_PURGE_CACHE_SECRET" https://api.pwnedpasswords.com/purge/ABCDE
```

`/purge` and `/purge/` both purge all ranges. `/purge/{prefix}` requires a five-character
hexadecimal prefix and purges only that tag in the range and Blob entrypoints. Successful
purges return `204 No Content`; missing or invalid credentials return `403`, invalid paths
return `400`, and a cache purge failure returns `502`. Purge responses are never cached.

The retired `hibp-purge-cache` header no longer requests a purge and is ignored on normal
range requests.

Miniflare does not currently implement the Workers cache purge API. Local purge requests
therefore log a warning and succeed as a no-op; deployed Workers perform the real purge.

Transient Microsoft Entra token and Blob download failures (408, 429, and 5xx responses)
and transport errors are retried up to five times. The Worker honors `Retry-After` when
supplied; otherwise it waits one second initially, then doubles the previous delay with
jitter.

## Deployment environments

| Environment | Worker | Public route |
| --- | --- | --- |
| `stage` | `pwnedpasswordsworkerstage` | `stage-api.pwnedpasswords.com/*` |
| `prod` | `pwnedpasswordsworkerprod` | `prod-api.pwnedpasswords.com/*`, `api.pwnedpasswords.com/range/*`, `api.pwnedpasswords.com/purge*` |

Pushing to `main` deploys the `stage` environment. The GitHub Actions **Deploy Worker**
workflow can be manually dispatched to select either `stage` or `prod`. Configure all seven
Worker secrets separately for both environments. The previously deployed private Blob Worker
is no longer deployed by this project and can be decommissioned manually when appropriate.

## Commands

```sh
pnpm dev
pnpm build
pnpm test
pnpm typecheck
pnpm types
pnpm deploy
pnpm deploy:prod
```
