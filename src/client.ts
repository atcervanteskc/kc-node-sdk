import {
  AuthenticationApi,
  Configuration,
  ResponseError,
  WatermarksApi,
  type AccessTokenResponse,
  type Middleware,
  type FetchAPI,
  type ResponseContext,
} from "../gen/src/index.js";
import { KeepChillError } from "./errors.js";

export interface KeepChillClientOptions {
  /**
   * Long-lived API key (sk_live_*). Never expose this in a browser.
   */
  apiKey: string;
  /**
   * Override the base URL. Defaults to the production gateway.
   */
  basePath?: string;
  /**
   * Override the fetch implementation (e.g. for tests, undici, or polyfills).
   */
  fetch?: FetchAPI;
  /**
   * Seconds of leeway before a cached JWT is considered expired.
   * Defaults to 60s so a request never fires with a token about to expire mid-flight.
   */
  tokenRefreshLeewaySeconds?: number;
}

/**
 * High-level KeepChill SDK client.
 *
 * v0.1 surface: authentication + signed-URL minting for the upload flow.
 *
 * Internally maintains two configurations:
 *   - auth config: sends `x-striker-api-key`. Used only for `/v1/auth/token`.
 *   - api config:  sends `Authorization: Bearer <jwt>`. Used for everything else.
 *
 * The JWT is minted lazily on first authenticated call, cached until
 * shortly before its `exp`, refreshed on demand, and re-minted once on a 401.
 */
export class KeepChillClient {
  private readonly apiKey: string;
  private readonly basePath: string;
  private readonly fetchApi?: FetchAPI;
  private readonly leewayMs: number;

  private cachedToken: string | null = null;
  private cachedTokenExpiresAt = 0; // epoch ms
  private inflight: Promise<string> | null = null;

  readonly auth: AuthenticationApi;
  readonly watermarks: WatermarksApi;

  constructor(opts: KeepChillClientOptions) {
    if (!opts.apiKey) {
      throw new Error("KeepChillClient: apiKey is required");
    }
    this.apiKey = opts.apiKey;
    this.basePath = opts.basePath ?? "https://api.keepchill.io";
    this.fetchApi = opts.fetch;
    this.leewayMs = (opts.tokenRefreshLeewaySeconds ?? 60) * 1000;

    const authConfig = new Configuration({
      basePath: this.basePath,
      fetchApi: this.fetchApi,
      apiKey: () => this.apiKey,
    });

    const refreshOn401: Middleware = {
      post: async (ctx: ResponseContext) => {
        if (ctx.response.status !== 401) return ctx.response;
        // Force a refresh; the next attempt mints a fresh JWT.
        this.invalidateToken();
        const fresh = await this.getValidToken();
        const headers = new Headers(ctx.init.headers as HeadersInit);
        headers.set("Authorization", `Bearer ${fresh}`);
        const retryInit: RequestInit = { ...ctx.init, headers };
        const fetchImpl = this.fetchApi ?? globalThis.fetch;
        return fetchImpl(ctx.url, retryInit);
      },
    };

    const apiConfig = new Configuration({
      basePath: this.basePath,
      fetchApi: this.fetchApi,
      accessToken: () => this.getValidToken(),
      middleware: [refreshOn401],
    });

    this.auth = new AuthenticationApi(authConfig);
    this.watermarks = new WatermarksApi(apiConfig);
  }

  /**
   * Returns a valid JWT, minting one if needed. Multiple concurrent callers
   * share the same in-flight mint so we don't pile up token requests.
   */
  async getValidToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedTokenExpiresAt - this.leewayMs) {
      return this.cachedToken;
    }
    if (this.inflight) return this.inflight;
    this.inflight = this.mintToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Drop the cached JWT. The next authenticated call will mint a new one. */
  invalidateToken(): void {
    this.cachedToken = null;
    this.cachedTokenExpiresAt = 0;
  }

  private async mintToken(): Promise<string> {
    let resp: AccessTokenResponse;
    try {
      resp = await this.auth.createAccessToken();
    } catch (err) {
      if (err instanceof ResponseError) {
        let body: unknown = null;
        try {
          body = await err.response.json();
        } catch {
          /* non-JSON body */
        }
        throw new KeepChillError(
          "Failed to mint access token",
          err.response.status,
          body,
        );
      }
      throw err;
    }
    this.cachedToken = resp.access_token;
    this.cachedTokenExpiresAt = Date.now() + resp.expires_in * 1000;
    return this.cachedToken;
  }
}
