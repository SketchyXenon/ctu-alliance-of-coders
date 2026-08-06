import { NextResponse } from "next/server";
import { handlePrismaError } from "./prisma-error";
import { logger } from "./logger";

export function withPrismaError<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<NextResponse>,
): (...args: TArgs) => Promise<NextResponse> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const prismaResp = handlePrismaError(error);
      if (prismaResp) return prismaResp;
      logger.error("Unhandled route error", { error: String(error) });
      return NextResponse.json(
        { error: "Internal server error." },
        { status: 500 },
      );
    }
  };
}
