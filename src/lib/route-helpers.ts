// Server-only route helpers.
// Per 03-software-engineering.md: separation of concerns.
//
// IMPORTANT: this module imports server-only deps (logger uses async_hooks,
// prisma-error uses @prisma/client). It MUST NOT be imported by client
// components. Only API route handlers import from here.
// validation.ts is kept client-safe; withPrismaError lives here instead.

import { NextResponse } from "next/server";
import { handlePrismaError } from "./prisma-error";
import { logger } from "./logger";

/**
 * Wrap an API route handler so Prisma errors get translated to HTTP responses,
 * and unexpected errors are logged and return a generic 500.
 * Per 06-security-architecture.md A10: fail closed, no stack traces to client.
 */
export function withPrismaError<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<NextResponse>
): (...args: TArgs) => Promise<NextResponse> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const prismaResp = handlePrismaError(error);
      if (prismaResp) return prismaResp;
      logger.error("Unhandled route error", { error: String(error) });
      return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
  };
}
