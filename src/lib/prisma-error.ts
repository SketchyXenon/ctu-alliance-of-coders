import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { logger } from "./logger";

/**
 * Translate Prisma errors to HTTP responses.
 * Returns null if the error isn't a recognized Prisma error.
 */
export function handlePrismaError(error: unknown): NextResponse | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002": // Unique constraint violation
        const target = (error.meta?.target as string[])?.join(", ") ?? "field";
        logger.warn("Unique constraint violation", { code: error.code, target });
        return NextResponse.json(
          { error: `A record with this ${target} already exists.` },
          { status: 409 }
        );
      case "P2025": // Record not found
        return NextResponse.json(
          { error: "Record not found." },
          { status: 404 }
        );
      case "P2003": // Foreign key constraint
        logger.warn("Foreign key constraint", { code: error.code });
        return NextResponse.json(
          { error: "Referenced record does not exist." },
          { status: 400 }
        );
      default:
        logger.error("Unhandled Prisma error", { code: error.code, message: error.message });
        return NextResponse.json(
          { error: "Database error." },
          { status: 500 }
        );
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    logger.error("Prisma validation error", { message: error.message });
    return NextResponse.json(
      { error: "Invalid data provided." },
      { status: 400 }
    );
  }

  return null;
}
