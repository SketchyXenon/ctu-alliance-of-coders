// Client-side API helpers. All requests use relative paths so the gateway
// can route them. Centralizes error handling and JSON parsing.

export interface ApiError {
  message: string;
  status: number;
}

// Per 02-system-design.md section 6: timeouts on every external call.
// 10s is generous for this app's endpoints (all are fast DB queries).
const REQUEST_TIMEOUT_MS = 10_000;

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<{ data: T | null; error: ApiError | null }> {
  try {
    // M3 fix: destructure headers out of options FIRST so the caller's headers
    // are merged on top of (not wiped by) the default Content-Type, and add a
    // timeout via AbortSignal so a hung backend doesn't hang the client.
    const { headers: callerHeaders, ...rest } = options ?? {};
    const res = await fetch(url, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(callerHeaders as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      return {
        data: null,
        error: { message: json.error || `Request failed (${res.status})`, status: res.status },
      };
    }
    return { data: json as T, error: null };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return {
      data: null,
      error: {
        message: isTimeout ? "Request timed out. Please try again." : err instanceof Error ? err.message : "Network error",
        status: 0,
      },
    };
  }
}

export const api = {
  get: <T>(url: string) => request<T>(url, { method: "GET" }),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
