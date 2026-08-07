# Dockerfile for the Alliance of Coders app.

# --- Stage 1: build ---
FROM oven/bun:1.3 AS build

WORKDIR /app

# Install dependencies first (cached layer).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build.
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1


RUN bunx prisma generate --schema=prisma/schema.prisma

RUN bun run build

FROM oven/bun:1.3-debian AS runtime

WORKDIR /app


RUN apt-get update && apt-get install -y --no-install-recommends caddy ca-certificates curl libcap2-bin \
    && rm -rf /var/lib/apt/lists/* \
    && setcap CAP_NET_BIND_SERVICE=+eip /usr/bin/caddy

COPY --from=build /app/.next/standalone ./next-service-dist
COPY --from=build /app/.next/static ./next-service-dist/.next/static
COPY --from=build /app/public ./next-service-dist/public
COPY --from=build /app/Caddyfile ./Caddyfile
COPY --from=build /app/.zscripts/start.sh ./start.sh
RUN chmod +x ./start.sh


RUN useradd -r -s /bin/false appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 81

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:81/api/health || exit 1

CMD ["./start.sh"]
