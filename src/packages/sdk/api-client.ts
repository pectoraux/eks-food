/** API client — lets extensions call platform APIs without direct HTTP. */
export interface ApiRequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  readonly status: number;
  readonly data: T;
  readonly headers: Record<string, string>;
}

export interface ApiClient {
  /** Call a platform API by path (e.g. `/api/v1/bookings`). Permission-checked at runtime. */
  call<T = unknown>(path: string, opts?: ApiRequestOptions): Promise<ApiResponse<T>>;
}

/** In-process ApiClient — calls route handlers directly (no HTTP overhead). */
export class InProcessApiClient implements ApiClient {
  constructor(
    private readonly organizationId: string,
    private readonly userId: string | null,
    private readonly grantedPermissions: readonly string[]
  ) {}

  async call<T = unknown>(path: string, opts: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
    const method = opts.method ?? "GET";
    const url = new URL(`http://localhost:3000${path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-eks-org": this.organizationId,
        ...(this.userId ? { "x-eks-user": this.userId } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, data: data as T, headers };
  }
}
