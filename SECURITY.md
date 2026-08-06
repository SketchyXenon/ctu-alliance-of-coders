# Security

Aligned with OWASP Top 10:2025 and the project's security architecture guide.

## Threat Model (STRIDE)

| Threat | Surface | Mitigation |
|--------|---------|------------|
| **Spoofing** | Login | scrypt password hashing, rate limiting, enumeration-resistant responses (DUMMY_HASH + identical 401) |
| **Tampering** | API mutations | CSRF protection (Origin/Sec-Fetch-Site), input validation (validateText with XSS blocklist), Prisma parameterized queries |
| **Repudiation** | Admin actions | Activity log with userId, action, entity, timestamp (login, logout, create, update, delete, reply, upload, test email) |
| **Information disclosure** | API responses, logs | Generic error messages, no stack traces, PII masked in logs (maskEmail), raw session IDs never logged, SMTP errors mapped to friendly messages |
| **Denial of service** | All endpoints | Rate limiting (IP + email + user), query limits (take: 100-200), payload size limits (8MB upload), dimension caps (2000x2000 image), `limitInputPixels` |
| **Elevation of privilege** | Admin routes | `requireAdmin()` on every mutation, role check, session rotation on password change (transactional) |

## OWASP Top 10:2025 Alignment

### A01 - Broken Access Control
- Every mutation checks `requireAdmin()` (authentication + role)
- Session-based: cookie is httpOnly, Secure (prod), SameSite=Lax
- Session rotation on password change (transactional, TOCTOU-safe)
- Max 5 sessions per user (transactional enforcement)
- IDOR prevention: all `[id]` routes fetch-then-404; sessions use SHA-256 surrogate IDs (raw token never leaves server)
- Contact reply: re-authorizes the message exists before sending

### A02 - Cryptographic Failures
- Passwords hashed with scrypt (N=16384, r=8, p=1, keylen=64, 16-byte salt) - async, non-blocking
- Session IDs: crypto.randomUUID (UUID v4)
- No plaintext passwords in logs or responses
- HSTS in production (2-year, includeSubDomains, preload)
- SMTP credentials server-only (never shipped to client)

### A03 - Injection (incl. XSS)
- Prisma parameterizes all queries (no string concatenation; one parameterless `$queryRaw` in health route)
- Input validation on every field (validateText with XSS blocklist, validateEmail, validateImageUrl, validateAnnouncementLink)
- React auto-escapes all rendered content
- No `dangerouslySetInnerHTML` with user input (3 uses are all static JSON-LD / theme flash)
- CSV exports route every cell through csvEscape (formula-injection defense, CWE-1236)
- Announcement links: URLs restricted to http/https (rejects javascript:, data:, file:)
- **Email header injection defense (CWE-93)**: contact `name` + `subject` validated with `rejectCRLF: true` at submission (prevents new injections); reply route applies `sanitizeForHeader()` to stored `existing.subject` + `existing.name` before they become email headers (defense-in-depth for records pre-dating the fix). Nodemailer also strips CRLF, but we reject early so the admin gets a clear 400 rather than a silently-mangled email.

### A04 - Insecure Design
- Threat-modeled with STRIDE (see above)
- Idempotency keys on contact form (clientId)
- TOCTOU prevention with transactions (createSession, rotateSession, sort-order, year uniqueness)
- Mass assignment prevention: explicit field allowlists in all PATCH routes

### A05 - Security Misconfiguration
- CSP: `script-src 'self' 'unsafe-inline'` (no unsafe-eval in prod; nonce-based CSP deferred)
- `X-Frame-Options: DENY` (clickjacking prevention)
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `poweredByHeader: false`
- `reactStrictMode: true`
- No `ignoreBuildErrors`
- Security headers set in 3 places (Caddyfile, next.config.ts, src/proxy.ts) — defense in depth

### A07 - Authentication Failures
- Rate limiting: 5/min per IP, 10/hour per email on login (unified 429 message — no enumeration signal)
- Same 401 response for: wrong email, wrong password, valid-creds-non-admin (DUMMY_HASH for timing equalization)
- Failed login attempts logged with masked email + IP
- Password change requires current password
- New password must differ from current, min 8 chars
- Session rotation on password change (transactional)

### A08 - Software & Data Integrity Failures
- TOCTOU on year uniqueness: caught with P2002 handling
- TOCTOU on contact idempotency: try-create-catch-P2002 pattern
- TOCTOU on sort-order: wrapped in `$transaction`
- TOCTOU on rotateSession: wrapped in `$transaction`
- Mass assignment prevention: explicit field allowlists in all PATCH routes
- Upload: magic-byte detection (file-type) not Content-Type; sharp re-encode strips polyglot payloads

### A09 - Security Logging Failures
- All admin actions logged to ActivityLog (login, logout, create, update, delete, reply, upload, test email)
- Structured JSON logger with request IDs (AsyncLocalStorage)
- Failed logins, failed password changes logged (masked email)
- Raw session IDs NOT logged (masked prefix only in rotateSession)
- SMTP errors logged server-side; only mapped friendly messages reach the client
- Activity log errors surfaced via logger (not silently swallowed)
- Gap (tech debt): no alerting on security-event spikes (documented in activity-log.md)

### A10 - Mishandling of Exceptional Conditions
- Prisma error handler (withPrismaError) translates P2002->409, P2025->404, P2003->400, PrismaClientInitializationError->503
- Generic error messages to clients, details in server logs
- Graceful degradation: health check reports degraded state; public GETs return empty arrays on DB-down (02 section 6)
- getCurrentUser fails closed on DB errors (returns null = logged out)
- SMTP errors mapped to user-friendly messages via mapSmtpError (no internal hostnames/ports leaked)
- Reply route does NOT mark message as resolved when email send fails (fail loud)

## CSRF Protection

The proxy (`src/proxy.ts`, renamed from `middleware.ts` in Next.js 16) enforces Origin/Sec-Fetch-Site allowlist on all non-GET requests:
- `Sec-Fetch-Site: same-origin` - allowed
- `Sec-Fetch-Site: none` - allowed (non-browser clients)
- Origin in allowlist (localhost, production domain) - allowed
- All other - blocked with 403

**Exemption — `POST /api/webhook/publish`**: this is a public, HMAC-signed endpoint meant to be called by external systems cross-origin. Its authorization model is the HMAC signature (verified in the route), not the browser Origin. Applying the CSRF origin check would block legitimate webhook deliveries. The route still enforces per-IP rate limiting, timestamp freshness (5-min replay window), and a timing-safe signature compare.

## Rate Limiting

| Endpoint | Limit | Window | Scope |
|----------|-------|--------|-------|
| POST /api/auth/login | 5 | 1 min | per IP |
| POST /api/auth/login | 10 | 1 hour | per email |
| POST /api/auth/change-password | 3 | 10 min | per user |
| POST /api/auth/logout | 20 | 1 min | per admin |
| POST /api/contact | 4 | 10 min | per IP |
| POST /api/contact | 2 | 30 min | per email |
| POST /api/contact/[id]/reply | 10 | 1 hour | per admin |
| POST /api/upload | 10 | 1 min | per admin |
| POST /api/integrations/email/test | 5 | 1 hour | per admin |
| PUT /api/integrations/[id] | 30 | 1 min | per admin |
| POST /api/integrations/[id]/test | 10 | 1 min | per admin |
| POST /api/announcements | 10 | 1 min | per admin |
| POST /api/officers | 20 | 1 min | per admin |
| POST /api/admin-years | 10 | 1 min | per admin |
| DELETE /api/sessions/[id] | 10 | 1 min | per admin |
| GET /api/activity/export | 5 | 1 min | per admin |
| GET /api/announcements/export | 5 | 1 min | per admin |
| POST /api/webhook/publish | 30 | 1 min | per IP |
| GET /api/health | 60 | 1 min | per IP |

**Note**: In-memory rate limiter is per-instance. For multi-instance production (Vercel serverless), use Redis/Upstash so limits are shared across instances. The limiter has periodic eviction to bound memory (entries untouched for 1 hour are swept). Tech debt: documented in activity-log.md.

## File Upload Security (9-layer defense)

1. Admin-only (requireAdmin)
2. Rate-limited (10/min per admin)
3. CSRF check (proxy.ts)
4. Max file size: 8MB (Content-Length pre-check + post-parse)
5. Magic-byte detection via `file-type` (not Content-Type, which is spoofable)
6. Allowlist: JPEG, PNG, WebP only
7. Sharp re-encode to WebP q82 (strips EXIF metadata + embedded payloads — the malware/script defense)
8. Server-generated filename (crypto.randomUUID, no user input in path)
9. Dimension cap: max 2000x2000, `limitInputPixels` = 4M (defeats decompression bombs)

Storage: Supabase Storage (prod) or local `public/uploads/` (dev). No silent fallback when Supabase is configured but fails — fail loud.

## Email Security

- SMTP credentials server-only (never shipped to client)
- Plain-text email only (no HTML XSS surface)
- Reply body validated with validateText (XSS blocklist, 5-4000 chars)
- Reply subject validated with validateText (max 200 chars, rejectCRLF for header-injection defense)
- **Email header injection defense (CWE-93)**: contact `name` + `subject` rejected at submission if they contain CR/LF (`rejectCRLF: true`); reply route applies `sanitizeForHeader()` to stored `existing.subject` + `existing.name` before they become email headers (defense-in-depth for pre-fix records)
- SMTP errors mapped to user-friendly messages via mapSmtpError (no internal hostnames/ports/stack traces leaked)
- BCC the admin on reply (sent-folder record)
- Rate-limited (10/hour per admin for replies, 5/hour for test emails)

## Integrations Security

External integrations (webhook + Discord, Google Workspace, Facebook, Google Forms) are managed via the admin panel. Each integration has a `IntegrationConfig` row storing `enabled`, JSON `config` (non-secret fields), and an opaque `secret` (credential / signing key).

**Secret handling (per 06 §8)**:
- Secrets are stored opaquely server-side and **never returned to the client** — only a masked preview (`…7890`) is exposed via `toStatus()`.
- The raw webhook signing key is returned **only once**: immediately after generation (on first enable/test) or rotation, so the admin can copy it. It is never retrievable again.
- Rotation invalidates the old key immediately.

**Webhook publish endpoint (`POST /api/webhook/publish`)**:
- Public (no admin session) — authorization is the HMAC-SHA256 signature.
- Rate-limited per IP **before** signature verification (bounds brute-force).
- Timestamp freshness: 5-minute window, rejects replay attacks. The timestamp is bound to the payload (`HMAC(secret, "${timestamp}.${body}")`), so a captured signature can't be reused on a different body.
- Timing-safe signature comparison (`crypto.timingSafeEqual`) prevents timing oracles.
- Full payload validation server-side (title 5-200, body 10-5000, type allowlist, links http/https only) — never trusts client input.
- Audit-logged with a synthetic `userId: "webhook"` actor.

**Outbound API integrations**:
- Per-integration token-shape validation (`validateSecret`): Discord bot tokens checked against the known format; generic printable-token check for others.
- Secrets validated separately from config (single `secret` column; `validateConfig` skips secret-type fields to avoid BOPLA/mass-assignment issues).
- Connectivity test (Discord: real `GET /users/@me`; others: shape-validation only, degrades gracefully on network block).

**CSRF exemption**: the webhook publish endpoint is the only state-changing route exempt from the proxy CSRF origin check (its auth is the HMAC signature). See CSRF Protection above.

## Session Security

- Cookie: `httpOnly`, `Secure` (prod), `SameSite=Lax`, `path=/`
- TTL: 8 hours
- Session ID: crypto.randomUUID (UUID v4)
- Max 5 sessions per user (oldest evicted on new login, transactional)
- Rotation on password change (transactional, TOCTOU-safe)
- Expired sessions cleaned up on access
- Raw session token never exposed in API responses (SHA-256 surrogate IDs)
- Raw session token never logged (masked prefix only)

## Secrets Management

- All secrets via environment variables (never in code)
- `.env` in `.gitignore`
- `.env.example` documents required vars (no real values)
- Production: Vercel environment variables
- Env validation via zod schema (`src/lib/env.ts`)
- Production requires Supabase env vars (enforced at runtime, fail fast)
- SMTP credentials checked at send time (not at boot — allows dev without SMTP)

## Supabase RLS

The `profiles` table + `auth.uid()`-based RLS policies were dead code (the app uses the service-role key which bypasses RLS) and were removed. The consolidated schema in `supabase/migrations/00000000000000_init.sql` keeps RLS enabled on every table (Supabase linter requirement) with minimal defense-in-depth policies: public read on public-facing tables, public insert on the contact form, and no policies on admin-only tables (default deny). All authorization is enforced in the application layer (Prisma + `requireAdmin`).

Storage buckets remain:
- `officer-photos` (public read, admin write via service-role key)
- `announcement-images` (public read, admin write via service-role key)

## Web Crawling & AI Policy

- `robots.txt`: allows `/`, disallows `/api/` (prevents endpoint enumeration)
- `llms.txt`: guides LLM crawlers to public content + policy
- `ai.txt`: AI scraper policy (allowed use cases, attribution, rate limits)
- `.well-known/security.txt`: responsible disclosure contact
