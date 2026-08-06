// Shared validation helpers for API route handlers.

import { NextResponse } from "next/server";
import { validateText, validateEmail } from "./security";

const MAX_IMAGE_URL_LEN = 2048;

const URL_PROTOCOL_RE = /^([a-z][a-z0-9+.-]*):/i;

export function validateImageUrl(value: unknown): {
  valid: boolean;
  error: string | null;
  normalized: string | null;
} {
  if (value === null || value === undefined || value === "") {
    return { valid: true, error: null, normalized: null };
  }
  if (typeof value !== "string") {
    return { valid: false, error: "Image must be a string.", normalized: null };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: true, error: null, normalized: null };
  }
  if (trimmed.length > MAX_IMAGE_URL_LEN) {
    return { valid: false, error: "Image URL is too long.", normalized: null };
  }

  if (trimmed.startsWith("/")) {
    if (trimmed.includes("..")) {
      return { valid: false, error: "Invalid image path.", normalized: null };
    }
    return { valid: true, error: null, normalized: trimmed };
  }
  const protoMatch = URL_PROTOCOL_RE.exec(trimmed);
  if (!protoMatch) {
    return { valid: false, error: "Invalid image URL.", normalized: null };
  }
  const proto = protoMatch[1].toLowerCase();
  if (proto !== "https") {
    return {
      valid: false,
      error: "Image URL must use https.",
      normalized: null,
    };
  }
  try {
    new URL(trimmed);
  } catch {
    return { valid: false, error: "Invalid image URL.", normalized: null };
  }
  return { valid: true, error: null, normalized: trimmed };
}

export function validatePassword(
  value: unknown,
  opts: { minLen?: number; maxLen?: number } = {},
): { valid: boolean; error: string | null; value: string | null } {
  const { minLen = 8, maxLen = 128 } = opts;
  if (typeof value !== "string") {
    return { valid: false, error: "Password must be a string.", value: null };
  }
  if (value.length === 0) {
    return { valid: false, error: "Password is required.", value: null };
  }
  if (value.length < minLen) {
    return {
      valid: false,
      error: `Password must be at least ${minLen} characters.`,
      value: null,
    };
  }
  if (value.length > maxLen) {
    return {
      valid: false,
      error: `Password must be under ${maxLen} characters.`,
      value: null,
    };
  }

  return { valid: true, error: null, value };
}

export async function parseJsonBody<T = Record<string, unknown>>(
  request: Request,
): Promise<{ ok: true; body: T } | { ok: false; response: NextResponse }> {
  try {
    const body = (await request.json()) as T;
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 },
      ),
    };
  }
}

export function rateLimitResponse(
  retryAfterMs: number,
  message: string,
): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
    },
  );
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export { validateText, validateEmail };
