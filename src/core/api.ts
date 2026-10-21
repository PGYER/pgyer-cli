import { getApiKey, getApiServers, type Config } from './config';
import { CLI_USER_AGENT } from './version';

/** Web address of PGYER download pages. */
export const WEB_URL = 'https://www.pgyer.com';

const API_TIMEOUT_MS = 30_000;

/** Hints for API error codes, worded like the PGYER Jenkins plugin. */
const ERROR_HINTS: Record<number, string> = {
  1001: 'Check that the API key is correct. You can find it at https://www.pgyer.com/account/api',
  1002: 'Check that the API key is correct. You can find it at https://www.pgyer.com/account/api',
  1003: 'Sub-accounts cannot use the API. Use the API key of the main account.',
  1019: 'Complete real-name verification before uploading: https://www.pgyer.com/account/certification',
  1020: 'Uploading is disabled for this account. Contact PGYER customer service.',
  1022: 'Your PGYER storage is full or the file is too large. Free up space or upgrade your plan.',
};

export function errorHint(code: number): string | undefined {
  return ERROR_HINTS[code];
}

/**
 * An error code returned by the PGYER API.
 */
export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public hint?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The server could not be reached or did not answer with PGYER API JSON.
 * Only these errors move on to the next API server.
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * API request options
 */
export interface RequestOptions {
  /**
   * Kept for compatibility. Every request is sent as a POST form so that the
   * API key never appears in a URL.
   */
  method?: 'GET' | 'POST';
  /** API path (e.g., /apiv2/app/listMy) */
  path: string;
  /** Form fields; undefined and null values are left out */
  params?: Record<string, unknown>;
  /** More form fields, merged after params */
  body?: Record<string, unknown>;
  /** Abort the request when the owning command is cancelled */
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  /** User-Agent header; defaults to the CLI's */
  userAgent?: string;
  /** API servers to try in order; defaults to the configured or PGYER ones */
  servers?: string[];
  /** Per-request timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * The server that answered last, per server list. Shared by every client in
 * the process so that a long-running `pgyer mcp` keeps using a domain that works.
 */
const preferredServer = new Map<string, number>();

interface ApiResponse {
  code: unknown;
  message?: unknown;
  data?: unknown;
}

/**
 * API Client class
 */
export class ApiClient {
  readonly servers: readonly string[];
  readonly userAgent: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(config: Config, options: ApiClientOptions = {}) {
    this.servers = options.servers?.length ? [...options.servers] : getApiServers(config);
    this.userAgent = options.userAgent ?? CLI_USER_AGENT;
    this.apiKey = getApiKey(config) ?? null;
    this.timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
  }

  /**
   * Call the API and return its data. Network errors and non-JSON answers move
   * on to the next server; a JSON API error stops immediately.
   */
  async request<T>(options: RequestOptions): Promise<T> {
    return (await this.requestWithServer<T>(options)).data;
  }

  /** Like request(), and also tells which server answered. */
  async requestWithServer<T>(options: RequestOptions): Promise<{ server: string; data: T }> {
    const form = this.buildForm(options);
    const listKey = this.servers.join(' ');
    const start = preferredServer.get(listKey) ?? 0;
    let lastFailure: NetworkError | undefined;
    for (let attempt = 0; attempt < this.servers.length; attempt += 1) {
      const index = (start + attempt) % this.servers.length;
      const server = this.servers[index];
      try {
        const data = await this.post<T>(server, options.path, form, options.signal);
        if (index !== start) preferredServer.set(listKey, index);
        return { server, data };
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
        lastFailure = error;
      }
    }
    if (this.servers.length === 1 && lastFailure) {
      throw new NetworkError(`${this.servers[0]} is not reachable (${lastFailure.message})`);
    }
    throw new NetworkError(
      `None of the PGYER API servers could be reached: ${this.servers.join(', ')}. ` +
        `Last error: ${lastFailure?.message ?? 'unknown'}`
    );
  }

  /** Call one server, without trying the others. */
  async requestAt<T>(server: string, options: RequestOptions): Promise<T> {
    return this.post<T>(server, options.path, this.buildForm(options), options.signal);
  }

  private buildForm(options: RequestOptions): URLSearchParams {
    if (!this.apiKey) {
      throw new ApiError(1001, 'API Key is required. Run "pgyer auth login" or set PGYER_API_KEY');
    }
    const form = new URLSearchParams();
    form.append('_api_key', this.apiKey);
    for (const source of [options.params, options.body]) {
      if (!source) continue;
      for (const [key, value] of Object.entries(source)) {
        if (value !== undefined && value !== null) {
          form.append(key, String(value));
        }
      }
    }
    return form;
  }

  private async post<T>(
    server: string,
    path: string,
    form: URLSearchParams,
    signal?: AbortSignal
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetch(server + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': this.userAgent,
        },
        body: form,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        // A redirect is never a PGYER API answer; treat it like a non-JSON page.
        redirect: 'manual',
      });
      text = await response.text();
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      throw new NetworkError(describeFailure(error));
    }

    let json: ApiResponse;
    try {
      json = JSON.parse(text) as ApiResponse;
    } catch {
      // Usually a captive portal, a hijacked DNS record or a proxy error page.
      throw new NetworkError(`HTTP ${response.status} with a non-JSON response`);
    }
    if (!json || typeof json !== 'object' || !('code' in json)) {
      throw new NetworkError(`HTTP ${response.status} with an unexpected response`);
    }

    const code = Number(json.code);
    if (code !== 0) {
      const message = typeof json.message === 'string' && json.message.trim()
        ? json.message.trim()
        : 'Unknown error';
      throw new ApiError(Number.isNaN(code) ? -1 : code, message, errorHint(code));
    }
    return json.data as T;
  }
}

/** A short reason for a failed fetch, without echoing request details. */
export function describeFailure(error: unknown): string {
  const err = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return 'timed out';
  }
  if (err?.cause) {
    return [err.cause.code, err.cause.message].filter(Boolean).join(' ') || String(err.cause);
  }
  return err?.message ?? String(error);
}

/**
 * Create API client from config
 */
export function createApiClient(config: Config, options?: ApiClientOptions): ApiClient {
  return new ApiClient(config, options);
}
