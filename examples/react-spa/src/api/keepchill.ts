/**
 * KeepChill API Client (SDK-backed)
 *
 * This module wraps the official @keepchill/node-sdk to demonstrate the full
 * upload flow end-to-end. Authentication and signed-URL minting go through
 * the SDK; the polling endpoints (`GET /v1/jobs/{job_id}`) are not yet part
 * of the SDK v0.1 surface, so they fall back to raw fetch using the JWT that
 * the SDK manages internally.
 *
 * The exported function surface is preserved 1:1 with the pre-SDK version so
 * `useWatermark.ts` does not need to change.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * ⚠️  SECURITY — API KEY HANDLING
 * ──────────────────────────────────────────────────────────────────────────────
 * Browser-direct usage of an `sk_live_*` key remains a demo pattern only.
 * Even with the SDK, the API key is in the browser bundle here — which is
 * what `@keepchill/node-sdk` explicitly warns against. For production,
 * proxy `/v1/auth/token` through your backend and only ship the short-lived
 * JWT to the frontend.
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * @see https://keepchill.io/docs
 */

import {
  KeepChillClient,
  KeepChillError,
  ResponseError,
} from "@keepchill/node-sdk";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Watermark style applied to the processed image. */
export type WatermarkType = "photographer" | "creator";

/**
 * File descriptor sent as part of the POST /v1/watermarks/signed-urls body.
 * One descriptor per file — batch up to 10 in a single call.
 */
export interface FileDescriptor {
  /** Sanitized filename with extension, e.g. "portrait_abc123.jpg" */
  name: string;
  /** MIME type — must match exactly what you will send in the GCS PUT */
  type: string;
  /** Watermark style to apply */
  watermark_type: WatermarkType;
}

/** One upload ticket returned per file by POST /v1/watermarks/signed-urls */
export interface UploadTicket {
  /** Per-file ID — identifies this file within the batch job */
  fileId: string;
  /** Batch job ID — use with GET /v1/jobs/{jobId} to poll status */
  jobId: string;
  filename: string;
  /** Pre-signed GCS URL — use for the PUT in Step 3. Expires in ~15 minutes. */
  uploadUrl: string;
}

/** Job record returned by GET /v1/jobs/{job_id} */
export interface JobResult {
  status: "pending" | "processing" | "success" | "error";
  /** Signed GCS download URL. Present only when status === "success". */
  processed_image_url?: string;
  /** Human-readable error description. Present only when status === "error". */
  error?: string;
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ── SDK client cache ──────────────────────────────────────────────────────────
//
// One client per (apiKey, basePath) tuple. Recreated transparently when the
// api key changes. The SDK handles token cache + refresh + 401 retry, so we
// don't repeat any of that here.
//
// BASE_URL is empty so all requests are same-origin relative paths. In dev,
// Vite (see vite.config.ts) proxies /v1 to the real KeepChill gateway so the
// browser never has to negotiate CORS with api.keepchill.io. In production,
// deploy this app behind a reverse proxy that forwards /v1 the same way.

const BASE_URL = "";

let _client: KeepChillClient | null = null;
let _clientKey: string | null = null;

function getClient(apiKey: string): KeepChillClient {
  if (_client && _clientKey === apiKey) return _client;
  _client = new KeepChillClient({ apiKey, basePath: BASE_URL });
  _clientKey = apiKey;
  return _client;
}

/**
 * Drop the cached SDK client and its cached JWT.
 * Call this when the API key changes so the next call re-authenticates.
 */
export function invalidateToken(): void {
  if (_client) _client.invalidateToken();
  _client = null;
  _clientKey = null;
}

// ── Error translation ─────────────────────────────────────────────────────────
//
// The SDK raises two error shapes:
//   - KeepChillError on token-mint failure (with .status and .body)
//   - ResponseError  on other non-2xx responses (with .response)
// We map both to the legacy ApiError so callers don't see the SDK leak.

async function toApiError(err: unknown, fallbackCode: string, fallbackMsg: string): Promise<ApiError> {
  if (err instanceof KeepChillError) {
    const body = (err.body ?? {}) as Record<string, unknown>;
    return new ApiError(
      err.status,
      String(body["error"] ?? fallbackCode),
      String(body["message"] ?? body["error"] ?? fallbackMsg),
    );
  }
  if (err instanceof ResponseError) {
    const status = err.response.status;
    let body: Record<string, unknown> = {};
    try {
      body = (await err.response.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON body */
    }
    return new ApiError(
      status,
      String(body["error"] ?? fallbackCode),
      String(body["message"] ?? body["error"] ?? fallbackMsg),
    );
  }
  return new ApiError(0, fallbackCode, err instanceof Error ? err.message : fallbackMsg);
}

// ── Auth (Step 1) ─────────────────────────────────────────────────────────────

/**
 * Exchange the API key for a short-lived JWT (or return the SDK's cached one).
 * Returns the raw JWT string; the SDK manages caching and refresh internally.
 *
 * @throws {ApiError} HTTP 401 — invalid API key.
 */
export async function getToken(apiKey: string): Promise<string> {
  try {
    return await getClient(apiKey).getValidToken();
  } catch (err) {
    throw await toApiError(err, "auth_error", "Authentication failed");
  }
}

// ── Watermark API (Step 2) ────────────────────────────────────────────────────

/**
 * Request pre-signed GCS upload URLs for a batch of files via the SDK.
 * Quota / credits are reserved at this point — each file costs 1 credit.
 *
 * @param _token  Ignored; the SDK already holds a valid JWT. The parameter is
 *                kept to preserve the legacy signature so `useWatermark.ts`
 *                continues to compile unchanged.
 * @param files   Up to 10 file descriptors.
 *
 * @throws {ApiError} HTTP 401 — token expired or invalid.
 * @throws {ApiError} HTTP 429 — quota exhausted and no credits available.
 */
export async function requestSignedUrls(
  _token: string,
  files: FileDescriptor[],
): Promise<UploadTicket[]> {
  if (!_clientKey || !_client) {
    throw new ApiError(0, "client_error", "API client not initialised — call getToken first");
  }
  try {
    const resp = await _client.watermarks.createSignedUploadUrls({
      signedUrlsRequest: {
        files: files.map((f) => ({
          name: f.name,
          type: f.type as "image/jpeg" | "image/png" | "image/webp",
          "watermark-type": f.watermark_type,
        })),
      },
    });
    return (resp.uploads ?? []).map((u) => ({
      fileId: u.file_id,
      jobId: resp.job_id,
      filename: u.filename,
      uploadUrl: u.upload_url,
    }));
  } catch (err) {
    throw await toApiError(err, "signed_url_error", "Failed to get upload URLs");
  }
}

// ── GCS Upload (Step 3) ───────────────────────────────────────────────────────

/**
 * Upload the raw file bytes to GCS using the pre-signed URL (HTTP PUT).
 * Not part of the SDK — the bytes go directly to Google Cloud Storage.
 *
 * Critical requirements:
 *  - Method must be PUT — never POST or multipart/form-data
 *  - Content-Type must exactly match what was declared in the FileDescriptor
 *  - Signed URLs expire after ~1 hour
 */
export async function uploadToGcs(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  if (!res.ok) {
    throw new Error(
      `GCS upload failed (HTTP ${res.status}). ` +
        "Verify the Content-Type matches exactly what was declared in Step 2, " +
        "and that the signed URL has not expired.",
    );
  }
}

// ── Job polling (Step 4) ──────────────────────────────────────────────────────
//
// `GET /v1/jobs/{job_id}` is not in @keepchill/node-sdk v0.1 yet, so we hit
// it directly with a JWT minted by the SDK. When the SDK adds Jobs in a future
// release, this whole block reduces to `client.jobs.getJob({ jobId })`.

/**
 * Fetch the current status of a single job from `GET /v1/jobs/{job_id}`.
 * Uses a JWT minted (and cached) by the SDK.
 */
export async function getJobStatus(jobId: string, fileId: string, _token: string): Promise<JobResult> {
  if (!_clientKey || !_client) {
    throw new ApiError(0, "client_error", "API client not initialised — call getToken first");
  }

  const jwt = await _client.getValidToken();
  const res = await fetch(`${BASE_URL}/v1/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // 401 means our cached JWT is stale; drop it so the next call re-mints.
    if (res.status === 401) _client.invalidateToken();
    throw new ApiError(
      res.status,
      String(body["error"] ?? "job_status_error"),
      String(body["message"] ?? `Failed to fetch status for job ${jobId} (HTTP ${res.status})`),
    );
  }

  const data = (await res.json()) as {
    id: string;
    files: Array<{
      file_id: string;
      status: string;
      signed_url: string | null;
      error_message?: string;
    }>;
  };
  const file = data.files.find((f) => f.file_id === fileId) ?? data.files[0];
  return {
    status: file.status as JobResult["status"],
    processed_image_url: file.signed_url ?? undefined,
    error: file.error_message,
  };
}

/**
 * Poll `GET /v1/jobs/{job_id}` every 30 seconds until the job reaches a
 * terminal state (success or error). Up to `maxAttempts` polls.
 */
export async function pollJob(
  jobId: string,
  fileId: string,
  token: string,
  maxAttempts = 20,
): Promise<JobResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const job = await getJobStatus(jobId, fileId, token);

    if (job.status === "success") return job;
    if (job.status === "error") {
      throw new Error(
        job.error ?? "Image processing failed — no details returned by the server.",
      );
    }

    if (attempt < maxAttempts - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 30_000));
    }
  }

  throw new Error(
    `Polling timed out for job ${jobId} after ${maxAttempts} attempts (${maxAttempts * 30} s).`,
  );
}
