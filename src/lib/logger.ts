import { AsyncLocalStorage } from "async_hooks";

interface RequestContext {
  requestId: string;
  userId?: string;
  ip?: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return requestContext.getStore();
}

type LogLevel = "debug" | "info" | "warn" | "error";

function formatLog(
  level: LogLevel,
  msg: string,
  meta?: Record<string, unknown>,
) {
  const ctx = getContext();
  const entry: Record<string, unknown> = {
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...(ctx?.requestId && { requestId: ctx.requestId }),
    ...(ctx?.userId && { userId: ctx.userId }),
    ...(ctx?.ip && { ip: ctx.ip }),
    ...meta,
  };
  return entry;
}

export const logger = {
  debug(msg: string, meta?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== "production") {
      console.debug(JSON.stringify(formatLog("debug", msg, meta)));
    }
  },
  info(msg: string, meta?: Record<string, unknown>) {
    console.info(JSON.stringify(formatLog("info", msg, meta)));
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    console.warn(JSON.stringify(formatLog("warn", msg, meta)));
  },
  error(msg: string, meta?: Record<string, unknown>) {
    console.error(JSON.stringify(formatLog("error", msg, meta)));
  },
};
