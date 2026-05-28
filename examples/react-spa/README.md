# React SPA example — @keepchill/node-sdk

A minimal Vite + React + TypeScript single-page app demonstrating how to integrate the [KeepChill Watermark API](https://keepchill.io/docs) using the **[@keepchill/node-sdk](../..)** that lives in the parent repo.

This example covers the **complete upload-and-watermark flow**:

1. Authenticating with an API key (SDK handles JWT exchange, caching, refresh, 401 retry)
2. Requesting signed GCS upload URLs for a batch of images (via `client.watermarks.createSignedUploadUrls`)
3. Uploading files directly to cloud storage (image bytes never touch KeepChill servers)
4. Polling `GET /v1/jobs/{job_id}` for processing results — using a JWT minted by the SDK

> Steps 1 and 2 go through the SDK. Step 3 is a direct GCS upload (not part of the API
> surface). Step 4 hits `/v1/jobs/{job_id}` directly because that endpoint is not yet
> in the SDK v0.1 surface — when it lands, the polling helper reduces to one SDK call.

---

## ⚠️ Security notice

This is a **client-side demo**. The API key is held in React component state (in-memory only, cleared on page refresh) and the token exchange happens in the browser. This is acceptable for:

- Personal tools
- Local development / testing
- Internal dashboards where you control the environment

**For production applications serving end-users**, never expose the API key client-side. Implement a backend proxy that performs the token exchange server-side and returns short-lived JWTs to your frontend. The API key must never leave your server.

---

## Prerequisites

- Node.js ≥ 18
- A KeepChill API key ([get one at keepchill.io](https://keepchill.io))

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Usage

1. Paste your KeepChill API key in the **Configuration** section
2. Select a watermark type (**Photographer** or **Content Creator**)
3. Drop or select up to 10 images (JPEG, PNG, or WebP — max 20 MB each)
4. Click **Process** and watch each file's status update in real time
5. Click **Download** next to each completed image

---

## API limits enforced in this example

| Constraint | Value | Source |
|---|---|---|
| Accepted formats | JPEG · PNG · WebP | API file validation |
| Max file size | 20 MB | API limit |
| Max files per batch | 10 | API batch limit |
| Signed URL expiry | ~15 minutes | Upload promptly after Step 1 |
| Watermark types | `photographer`, `creator` | API enum |

---

## Project structure

```
src/
├── api/
│   └── keepchill.ts         # API client — token, signed-urls, GCS upload, job polling
├── hooks/
│   └── useWatermark.ts      # State machine for the full upload pipeline
├── components/
│   ├── ApiKeyInput.tsx       # API key field with show/hide toggle + security notice
│   ├── WatermarkTypeSelector.tsx
│   ├── FileDropZone.tsx      # Drag-and-drop / file picker with validation
│   └── FileList.tsx          # Per-file status rows + download links
├── App.tsx                   # Main layout
├── main.tsx
└── index.css                 # Design tokens (matches keepchill.io dark theme)
```

The two files worth reading first are `src/api/keepchill.ts` (the raw API calls) and `src/hooks/useWatermark.ts` (the state machine that orchestrates them).

---

## References

- [Developer Guide](https://keepchill.io/docs)
- [API Reference](https://api.keepchill.io)
- [Support](mailto:support@keepchill.io)
