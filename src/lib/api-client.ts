export interface ApiError {
  message: string;
  status: number;
}

const REQUEST_TIMEOUT_MS = 10_000;

async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<{ data: T | null; error: ApiError | null }> {
  try {
    const { headers: callerHeaders, ...rest } = options ?? {};

    const headers: Record<string, string> = {
      ...(callerHeaders as Record<string, string> | undefined),
    };
    if (rest.body) headers["Content-Type"] = "application/json";
    const res = await fetch(url, {
      ...rest,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      return {
        data: null,
        error: {
          message: json.error || `Request failed (${res.status})`,
          status: res.status,
        },
      };
    }
    return { data: json as T, error: null };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return {
      data: null,
      error: {
        message: isTimeout
          ? "Request timed out. Please try again."
          : err instanceof Error
            ? err.message
            : "Network error",
        status: 0,
      },
    };
  }
}

export const api = {
  get: <T>(url: string) => request<T>(url, { method: "GET" }),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: "DELETE",
      body: body ? JSON.stringify(body) : undefined,
    }),
};
