import { getApiUrl, getApiKey, type Config } from './config';

/**
 * API Error class
 */
export class ApiError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * API request options
 */
export interface RequestOptions {
  /** HTTP method */
  method: 'GET' | 'POST';
  /** API path (e.g., /apiv2/app/list) */
  path: string;
  /** Query parameters */
  params?: Record<string, unknown>;
  /** Request body */
  body?: FormData | Record<string, unknown>;
  /** Abort the request when the owning command times out */
  signal?: AbortSignal;
}

/**
 * API response wrapper
 */
interface ApiResponse<T> {
  code: number;
  message: string;
  data?: T;
}

/**
 * API Client class
 */
export class ApiClient {
  private baseUrl: string;
  private apiKey: string | null;

  constructor(config: Config) {
    this.baseUrl = getApiUrl(config);
    this.apiKey = getApiKey(config) ?? null;
  }

  /**
   * Make an API request
   */
  async request<T>(options: RequestOptions): Promise<T> {
    if (!this.apiKey) {
      throw new ApiError(1001, 'API Key is required. Run "pgyer auth login" or set PGYER_API_KEY');
    }
    const url = new URL(this.baseUrl + options.path);

    // Build query params
    const params = { ...options.params };
    if (this.apiKey) {
      params._api_key = this.apiKey;
    }

    // Build fetch options
    const fetchOptions: RequestInit = {
      method: options.method,
      signal: options.signal,
    };

    // Handle body for POST requests
    if (options.method === 'POST') {
      if (options.body instanceof FormData) {
        // FormData: add API key and use as-is
        if (this.apiKey) {
          options.body.append('_api_key', this.apiKey);
        }
        fetchOptions.body = options.body;
      } else {
        // JSON body or params: convert to URLSearchParams
        const formParams = new URLSearchParams();
        if (this.apiKey) {
          formParams.append('_api_key', this.apiKey);
        }
        if (options.params) {
          Object.entries(options.params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
              formParams.append(key, String(value));
            }
          });
        }
        if (options.body) {
          Object.entries(options.body).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
              formParams.append(key, String(value));
            }
          });
        }
        fetchOptions.headers = {
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        fetchOptions.body = formParams.toString();
      }
    } else if (options.method === 'GET') {
      // GET: add params to URL
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), fetchOptions);
    return this.handleResponse<T>(response);
  }

  /**
   * Handle API response
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    let data: ApiResponse<T>;

    try {
      data = (await response.json()) as ApiResponse<T>;
    } catch {
      throw new ApiError(-1, 'Failed to parse response');
    }

    if (data.code !== 0) {
      throw new ApiError(data.code, data.message || 'Unknown error');
    }

    return data.data as T;
  }
}

/**
 * Create API client from config
 */
export function createApiClient(config: Config): ApiClient {
  return new ApiClient(config);
}
