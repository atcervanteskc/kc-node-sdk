import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeepChillClient, KeepChillError } from "../src/index.js";

type FetchCall = { url: string; init?: RequestInit };

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const call = { url, init };
    calls.push(call);
    return handler(call);
  });
  return { impl, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function signedUrlsOk(jobId = "00000000-0000-0000-0000-000000000aaa") {
  return jsonResponse(200, {
    job_id: jobId,
    uploads: [
      {
        file_id: "00000000-0000-0000-0000-000000000bbb",
        filename: "beach-01.jpg",
        upload_url: "https://storage.googleapis.com/bucket/signed?sig=…",
        expires_at: "2026-05-27T13:00:00Z",
      },
    ],
  });
}

const SAMPLE_REQUEST = {
  signedUrlsRequest: {
    files: [
      {
        name: "beach-01.jpg",
        type: "image/jpeg" as const,
      },
    ],
  },
};

describe("KeepChillClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-27T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires an apiKey", () => {
    expect(() => new KeepChillClient({ apiKey: "" })).toThrow(/apiKey is required/);
  });

  it("mints a JWT on the first signed-urls call and caches it for the second", async () => {
    let tokenMints = 0;
    const { impl, calls } = mockFetch((call) => {
      if (call.url.endsWith("/v1/auth/token")) {
        tokenMints++;
        return jsonResponse(200, {
          access_token: "jwt-1",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (call.url.endsWith("/v1/watermarks/signed-urls")) {
        return signedUrlsOk();
      }
      return jsonResponse(404, { error: "unexpected" });
    });

    const client = new KeepChillClient({
      apiKey: "sk_live_test",
      fetch: impl as unknown as typeof fetch,
    });

    const a = await client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST);
    const b = await client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST);

    expect(a.uploads?.[0]?.filename).toBe("beach-01.jpg");
    expect(b.uploads?.[0]?.filename).toBe("beach-01.jpg");
    expect(tokenMints).toBe(1);

    const authCall = calls.find((c) => c.url.endsWith("/v1/auth/token"));
    expect(authCall?.init?.headers).toBeDefined();
    const authHeaders = new Headers(authCall!.init!.headers as HeadersInit);
    expect(authHeaders.get("x-striker-api-key")).toBe("sk_live_test");

    const signedCalls = calls.filter((c) => c.url.endsWith("/v1/watermarks/signed-urls"));
    expect(signedCalls).toHaveLength(2);
    for (const c of signedCalls) {
      const h = new Headers(c.init!.headers as HeadersInit);
      expect(h.get("Authorization")).toBe("Bearer jwt-1");
      expect(h.get("x-striker-api-key")).toBeNull();
    }
  });

  it("re-mints when the cached token is past its leeway window", async () => {
    let mints = 0;
    const { impl } = mockFetch((call) => {
      if (call.url.endsWith("/v1/auth/token")) {
        mints++;
        return jsonResponse(200, {
          access_token: `jwt-${mints}`,
          token_type: "Bearer",
          expires_in: 60, // 1 minute lifetime
        });
      }
      return signedUrlsOk();
    });

    const client = new KeepChillClient({
      apiKey: "sk_live_test",
      fetch: impl as unknown as typeof fetch,
      tokenRefreshLeewaySeconds: 30,
    });

    await client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST);
    expect(mints).toBe(1);

    // Advance past the leeway boundary (60s exp - 30s leeway = expires at +30s).
    vi.setSystemTime(new Date("2026-05-27T12:00:31Z"));
    await client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST);
    expect(mints).toBe(2);
  });

  it("refreshes the token once on a 401 and retries the original call", async () => {
    let mints = 0;
    let attempts = 0;
    const { impl } = mockFetch((call) => {
      if (call.url.endsWith("/v1/auth/token")) {
        mints++;
        return jsonResponse(200, {
          access_token: `jwt-${mints}`,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (call.url.endsWith("/v1/watermarks/signed-urls")) {
        attempts++;
        if (attempts === 1) {
          return jsonResponse(401, { error: "Unauthorized" });
        }
        return signedUrlsOk();
      }
      return jsonResponse(404, { error: "unexpected" });
    });

    const client = new KeepChillClient({
      apiKey: "sk_live_test",
      fetch: impl as unknown as typeof fetch,
    });

    const result = await client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST);
    expect(result.uploads).toHaveLength(1);
    expect(mints).toBe(2);
    expect(attempts).toBe(2);
  });

  it("dedupes concurrent token mints into a single in-flight request", async () => {
    let mints = 0;
    let resolveMint: ((r: Response) => void) | null = null;
    const { impl } = mockFetch((call) => {
      if (call.url.endsWith("/v1/auth/token")) {
        mints++;
        return new Promise<Response>((resolve) => {
          resolveMint = resolve;
        });
      }
      return signedUrlsOk();
    });

    const client = new KeepChillClient({
      apiKey: "sk_live_test",
      fetch: impl as unknown as typeof fetch,
    });

    const a = client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST);
    const b = client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST);

    await vi.waitFor(() => expect(resolveMint).not.toBeNull());
    resolveMint!(
      jsonResponse(200, {
        access_token: "jwt-shared",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );

    await Promise.all([a, b]);
    expect(mints).toBe(1);
  });

  it("wraps a JSON 401 from the token endpoint as KeepChillError", async () => {
    const { impl } = mockFetch((call) => {
      if (call.url.endsWith("/v1/auth/token")) {
        return jsonResponse(401, { error: "Invalid API Key" });
      }
      return jsonResponse(404, { error: "unexpected" });
    });

    const client = new KeepChillClient({
      apiKey: "sk_live_bad",
      fetch: impl as unknown as typeof fetch,
    });

    await expect(
      client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST),
    ).rejects.toMatchObject({
      name: "KeepChillError",
      status: 401,
      body: { error: "Invalid API Key" },
    });
    expect(KeepChillError).toBeDefined();
  });

  it("wraps a non-JSON 401 body as KeepChillError with body=null", async () => {
    const { impl } = mockFetch((call) => {
      if (call.url.endsWith("/v1/auth/token")) {
        return new Response("not-json", {
          status: 401,
          headers: { "content-type": "text/plain" },
        });
      }
      return jsonResponse(404, { error: "unexpected" });
    });

    const client = new KeepChillClient({
      apiKey: "sk_live_test",
      fetch: impl as unknown as typeof fetch,
    });

    await expect(
      client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST),
    ).rejects.toMatchObject({
      name: "KeepChillError",
      status: 401,
      body: null,
    });
  });

  it("re-throws non-ResponseError errors raised during token mint", async () => {
    const { impl } = mockFetch(() => {
      throw new Error("network unreachable");
    });

    const client = new KeepChillClient({
      apiKey: "sk_live_test",
      fetch: impl as unknown as typeof fetch,
    });

    await expect(
      client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST),
    ).rejects.toMatchObject({
      name: "FetchError",
    });
  });

  it("invalidateToken() forces the next call to re-mint", async () => {
    let mints = 0;
    const { impl } = mockFetch((call) => {
      if (call.url.endsWith("/v1/auth/token")) {
        mints++;
        return jsonResponse(200, {
          access_token: `jwt-${mints}`,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      return signedUrlsOk();
    });
    const client = new KeepChillClient({
      apiKey: "sk_live_test",
      fetch: impl as unknown as typeof fetch,
    });
    await client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST);
    client.invalidateToken();
    await client.watermarks.createSignedUploadUrls(SAMPLE_REQUEST);
    expect(mints).toBe(2);
  });
});
