import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { logger } from "./logger";

function getErrorName(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const name = (error as { name?: string }).name;
  if (typeof name === "string" && name) return name;
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

export function handlePrismaError(error: unknown): NextResponse | null {
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
      case "P2002":
        const target = (error.meta?.target as string[])?.join(", ") ?? "field";
        logger.warn("Unique constraint violation", { code, target });
        return NextResponse.json(
          { error: `A record with this ${target} already exists.` },
          { status: 409 },
        );
      case "P2025":
        return NextResponse.json(
          { error: "Record not found." },
          { status: 404 },
        );
      case "P2003":
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

  if (isPrismaUnknownRequestError(error)) {
    logger.error("Unknown database request error", {
      message: (error as Error).message,
    });
    return NextResponse.json(
      { error: "Service temporarily unavailable. Please try again." },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }

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
