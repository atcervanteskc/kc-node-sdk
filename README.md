# @keepchill/node-sdk

Official Node.js SDK for the [KeepChill](https://keepchill.io) watermark API.

- Auto-managed authentication: pass your `sk_live_*` key once, the SDK handles JWT exchange, caching, and refresh
- Typed request/response models generated from the OpenAPI 3.1 spec
- Zero runtime dependencies — uses the built-in `fetch` (Node ≥ 18)

> **v0.1 surface.** This release covers the **upload flow only**: token exchange
> and signed-URL minting. Read endpoints (jobs, files, tenants, credits,
> subscriptions) are tracked in the OpenAPI spec and will land in a follow-up.

## Install

```bash
npm install @keepchill/node-sdk
```

## Examples

See **[examples/](./examples)** for runnable apps that consume this SDK:

- **[`examples/react-spa`](./examples/react-spa)** — Vite + React + TypeScript single-page app demonstrating the full upload flow end-to-end.

## Quick start

```ts
import { readFile } from "node:fs/promises";
import { KeepChillClient } from "@keepchill/node-sdk";

const client = new KeepChillClient({
  apiKey: process.env.KEEPCHILL_API_KEY!, // sk_live_*
});

// 1. Reserve signed upload URLs
const batch = await client.watermarks.createSignedUploadUrls({
  signedUrlsRequest: {
    files: [
      { name: "beach-01.jpg", type: "image/jpeg", "watermark-type": "photographer" },
      { name: "beach-02.jpg", type: "image/jpeg", "watermark-type": "photographer" },
    ],
  },
});

console.log("job:", batch.job_id);

// 2. Upload bytes directly to Google Cloud Storage
for (const upload of batch.uploads ?? []) {
  const bytes = await readFile(upload.filename);
  await fetch(upload.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: bytes,
  });
}
```

Once uploads complete, the API processes each file asynchronously. Until the
job/file read endpoints ship in the SDK, poll job status via your own `fetch`
to `GET /v1/jobs/{job_id}` using the JWT returned by `client.auth.createAccessToken()`,
or — preferred — configure a `webhook_url` on the request and let the API
notify you on completion.

## Authentication model

The SDK never asks you to handle JWTs. Internally it:

1. Holds your `sk_live_*` key in memory only
2. Calls `POST /v1/auth/token` on the first request that needs auth
3. Caches the returned JWT until 60 s before its `exp`
4. On a `401`, drops the cached token, mints a new one, and retries the original request once
5. Dedupes concurrent token mints into a single in-flight request

You can drop the cached token manually if needed:

```ts
client.invalidateToken();
```

> **Security note:** `sk_live_*` keys are server credentials. Never ship them
> in a browser bundle. The SDK is safe to use from Node, Deno, Bun, or any
> backend runtime — but not from untrusted clients. Browser-direct usage
> requires a publishable-key flow that is on the KeepChill roadmap.

## Configuration

```ts
new KeepChillClient({
  apiKey: "sk_live_…",          // required
  basePath: "https://api.staging.keepchill.io", // optional — defaults to prod
  fetch: customFetch,            // optional — inject e.g. undici, polyfill, mock
  tokenRefreshLeewaySeconds: 60, // optional — refresh tokens this many seconds before exp
});
```

## Public surface

```ts
client.auth        // AuthenticationApi  (token exchange — rarely called directly)
client.watermarks  // WatermarksApi      (createSignedUploadUrls)
```

Every method returns a fully-typed response. Errors raised by the API are
thrown as the generator's `ResponseError`; token-mint failures are wrapped
in `KeepChillError` with `status` and parsed `body`.

## Development

This package is generated from the KeepChill OpenAPI 3.1 spec. To regenerate
after a spec change (assumes the spec lives at a sibling path):

```bash
../keep-chill/scripts/generate-sdks.sh node
```

Hand-written code lives under `src/` and is never touched by regeneration.
Generated code lives under `gen/` and is fully overwritten on each run.

```bash
npm install
npm run lint            # type-check
npm test                # run tests
npm run test:coverage   # with coverage thresholds
npm run build           # emit dist/
```

## Support

- Documentation: <https://keepchill.io/docs>
- API reference: <https://api.keepchill.io>
- Issues: <mailto:support@keepchill.io>
