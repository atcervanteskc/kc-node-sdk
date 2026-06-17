# Examples

Runnable apps that consume `@keepchill/node-sdk` from npm. Each example is a
self-contained project — install its own deps, run its own dev server.

| Example | Stack | Demonstrates |
|---|---|---|
| [`react-spa`](./react-spa) | Vite · React 19 · TypeScript · Tailwind | End-to-end upload flow: SDK-managed JWT, signed URLs, direct GCS upload, job polling |

> Examples are **not** published to npm. They live in this repo for discoverability
> and as living integration tests against the published SDK.

## Job completion notifications

The `react-spa` example **polls** `GET /v1/jobs/{job_id}` until each job reaches
`success` or `failure` — the right approach for a browser-only app, since a SPA
cannot receive a server-to-server webhook directly. The polling state machine
lives in [`react-spa/src/hooks/useWatermark.ts`](./react-spa/src/hooks/useWatermark.ts).

If your code runs on a server, prefer the **webhook push** path instead: pass a
`webhook_url` to `/v1/watermarks/signed-urls` and KeepChill `POST`s the signed
result to your endpoint when processing finishes. See
[Job Completion Notifications](../../README.md#job-completion-notifications) for
both mechanisms, and the
[Developer Guide → Receiving Results](../../docs/developer-guide.md#receiving-results)
for the full payload and signature reference.
