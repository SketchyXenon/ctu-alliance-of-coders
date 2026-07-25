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

## Rate Limiting

| Endpoint | Limit | Window | Scope |
|----------|-------|--------|-------|
| POST /api/auth/login | 5 | 1 min | per IP |
| POST /api/auth/login | 10 | 1 hour | per email |
| POST /api/auth/change-password | 3 | 10 min | per user |
| POST /api/contact | 4 | 10 min | per IP |
| POST /api/contact | 2 | 30 min | per email |
| POST /api/contact/[id]/reply | 10 | 1 hour | per admin |
| POST /api/upload | 10 | 1 min | per admin |
| POST /api/integrations/email/test | 5 | 1 hour | per admin |
| POST /api/announcements | 10 | 1 min | per admin |
| POST /api/officers | 20 | 1 min | per admin |
| POST /api/admin-years | 10 | 1 min | per admin |
| GET /api/health | 60 | 1 min | per IP |

**Note**: In-memory rate limiter is per-instance. For multi-instance production, use Redis/Upstash. The limiter has periodic eviction to bound memory (entries untouched for 1 hour are swept).

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
- Reply subject validated with validateText (max 200 chars)
- SMTP errors mapped to user-friendly messages via mapSmtpError (no internal hostnames/ports/stack traces leaked)
- BCC the admin on reply (sent-folder record)
- Rate-limited (10/hour per admin for replies, 5/hour for test emails)

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

The `profiles` table + RLS policies were dead code (the app uses the service-role key which bypasses RLS). They were cleaned up in `supabase/migrations/20260725000000_drop_profiles_dead_code.sql`. All authorization is enforced in the application layer (Prisma + `requireAdmin`).

Storage buckets remain:
- `officer-photos` (public read, admin write via service-role key)
- `announcement-images` (public read, admin write via service-role key)

## Web Crawling & AI Policy

- `robots.txt`: allows `/`, disallows `/api/` (prevents endpoint enumeration)
- `llms.txt`: guides LLM crawlers to public content + policy
- `ai.txt`: AI scraper policy (allowed use cases, attribution, rate limits)
- `.well-known/security.txt`: responsible disclosure contact
