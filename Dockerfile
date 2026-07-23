# Dockerfile for the Alliance of Coders app.
# Multi-stage build: install deps + build in stage 1, copy standalone to a
# minimal runtime image in stage 2. Per 02-system-design.md section 5
# (stateless services) and 06-security-architecture.md section 9 (network
# posture). No emojis (Z.md).

# --- Stage 1: build ---
FROM oven/bun:1.3 AS build

WORKDIR /app

# Install dependencies first (cached layer).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build.
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# --- Stage 2: runtime ---
# Uses the debian-slim base because sharp needs native libs and the standalone
# server may need /usr/bin/env. bun is included for running server.js.
FROM oven/bun:1.3-debian AS runtime

WORKDIR /app

# Install Caddy for the gateway (same as the .zscripts/start.sh model).
# If Caddy isn't available in your registry, use the tarball approach instead.
RUN apt-get update && apt-get install -y --no-install-recommends caddy ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Copy the standalone build (already includes .next/static and public via the
# build script's cp commands).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/Caddyfile ./Caddyfile
COPY --from=build /app/.zscripts/start.sh ./start.sh
RUN chmod +x ./start.sh

# Non-root user for defense-in-depth (06 section 9).
RUN useradd -r -s /bin/false appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 81

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Health check hits the app health endpoint (Caddy proxies :81 -> :3000).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:81/api/health || exit 1

# start.sh launches Next.js in the background and execs Caddy as PID 1.
CMD ["./start.sh"]
