import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { logger } from "./logger";

/**
 * Duck-type an error as a Prisma error by its constructor name.
 *
 * WHY: In bundled serverless builds (Vercel, Next.js standalone), the
 * `@prisma/client` module can resolve to a different instance than the one
 * the generated client extends. When that happens, `error instanceof
 * Prisma.PrismaClientInitializationError` returns false even though the error
 * IS that class — the constructor identity differs across module instances.
 * This caused PrismaClientInitializationError to fall through to "Unhandled
 * route error" (500) on Vercel despite the instanceof check.
 *
 * The constructor `name` is a stable string set by Prisma's runtime and does
 * not depend on module identity, so it is reliable across bundles. We use
 * instanceof first (fast path, keeps types) and fall back to name matching
 * (robust path). Per 02 section 6: "Assume every dependency will fail, and
 * design for it." Per 03 section 6: "fail safe on expected, recoverable
 * conditions."
 */
function getErrorName(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  // Prisma errors set `name` on the constructor prototype; prefer it.
  const name = (error as { name?: string }).name;
  if (typeof name === "string" && name) return name;
  // Fall back to the constructor function name.
  const ctor = (error as { constructor?: { name?: string } }).constructor;
  return ctor?.name ?? "";
}

function isPrismaInitError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientInitializationError ||
    getErrorName(error) === "PrismaClientInitializationError"
  );
}

function isPrismaRustPanic(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientRustPanicError ||
    getErrorName(error) === "PrismaClientRustPanicError"
  );
}

function isPrismaKnownRequestError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    getErrorName(error) === "PrismaClientKnownRequestError"
  );
}

function isPrismaValidationError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientValidationError ||
    getErrorName(error) === "PrismaClientValidationError"
  );
}

function isPrismaUnknownRequestError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    getErrorName(error) === "PrismaClientUnknownRequestError"
  );
}

/**
 * Translate Prisma errors to HTTP responses.
 * Returns null if the error isn't a recognized Prisma error.
 * Per 06-security-architecture.md A10: error responses reveal what the user
 * needs, not stack traces or internal state. Per 02-system-design.md section 6:
 * graceful degradation under dependency failure.
 */
export function handlePrismaError(error: unknown): NextResponse | null {
  // Connection / initialization errors (DB unreachable, paused Supabase project,
  // network timeout). Map to 503 Service Unavailable so clients can retry.
  if (isPrismaInitError(error)) {
    logger.error("Database connection failed", {
      message: (error as Error).message,
    });
    return NextResponse.json(
      {
        error: "Service temporarily unavailable. Please try again in a moment.",
      },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }

  // Rust panic (query engine crash) — also a 503, not a client error.
  if (isPrismaRustPanic(error)) {
    logger.error("Database engine error", {
      message: (error as Error).message,
    });
    return NextResponse.json(
      { error: "Service temporarily unavailable. Please try again." },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }

  if (isPrismaKnownRequestError(error)) {
    const code = error.code;
    switch (code) {
      case "P2002": // Unique constraint violation
        const target = (error.meta?.target as string[])?.join(", ") ?? "field";
        logger.warn("Unique constraint violation", { code, target });
        return NextResponse.json(
          { error: `A record with this ${target} already exists.` },
          { status: 409 },
        );
      case "P2025": // Record not found
        return NextResponse.json(
          { error: "Record not found." },
          { status: 404 },
        );
      case "P2003": // Foreign key constraint
        logger.warn("Foreign key constraint", { code });
        return NextResponse.json(
          { error: "Referenced record does not exist." },
          { status: 400 },
        );
      default:
        logger.error("Unhandled Prisma error", {
          code,
          message: error.message,
        });
        return NextResponse.json({ error: "Database error." }, { status: 500 });
    }
  }

  if (isPrismaValidationError(error)) {
    logger.error("Prisma validation error", {
      message: (error as Error).message,
    });
    return NextResponse.json(
      { error: "Invalid data provided." },
      { status: 400 },
    );
  }

  // Unknown Prisma request errors (timeouts during query, etc.) — 503.
  if (isPrismaUnknownRequestError(error)) {
    logger.error("Unknown database request error", {
      message: (error as Error).message,
    });
    return NextResponse.json(
      { error: "Service temporarily unavailable. Please try again." },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }

  // Last-resort: if the error message clearly indicates a DB connection
  // failure (some Prisma versions wrap the message without a matching class),
  // still return 503 rather than leaking a 500. This catches messages like
  // "Can't reach database server" regardless of the error class.
  const msg = (error as { message?: string })?.message ?? "";
  if (
    /Can't reach database server|Timed out|connect ECONNREFUSED|ENOTFOUND|Tenant or database not found/i.test(
      msg,
    )
  ) {
    logger.error("Database connection failed (message match)", {
      message: msg,
    });
    return NextResponse.json(
      {
        error: "Service temporarily unavailable. Please try again in a moment.",
      },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }

  return null;
}
