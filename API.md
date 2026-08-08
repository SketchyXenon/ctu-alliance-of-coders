# API Reference

Base URL: `http://localhost:3000` (dev) or `https://allianceofcoders.ph` (prod)

All non-GET requests require an `Origin` header matching the site (CSRF protection).

## Public Endpoints

### GET /api/site-data
Returns all announcements (with links) + officer years in one call.

**Response**: `{ data: { announcements: Announcement[], adminYears: AdminYear[] } }`
**Cache**: `public, s-maxage=60, stale-while-revalidate=300`

### GET /api/announcements
List all announcements, newest first.

**Response**: `{ items: Announcement[] }`
**Cache**: `public, s-maxage=60, stale-while-revalidate=300`

### GET /api/admin-years
List all leadership years with officers.

**Response**: `{ items: AdminYear[] }`
**Cache**: `public, s-maxage=60, stale-while-revalidate=300`

### POST /api/contact
Submit a contact form message. Rate-limited per IP and per email.

**Body**: `{ name, email, subject, category, message, clientId }`
**Response**: `{ ok: true }` (201) or `{ ok: true }` (200 on dedup hit)
**Rate limit**: 4 per 10 min per IP, 2 per 30 min per email

### GET /api/health
Health check for monitoring.

**Response**: `{ status: "healthy"|"degraded", checks: { app, db }, timestamp }`
**Rate limit**: 60/min per IP

## Auth Endpoints

### POST /api/auth/login
**Body**: `{ email, password }`
**Response**: `{ requiresMfa: true, challengeId, emailMasked, delivered }` (200) — an MFA challenge is issued; the session is NOT created until the code is verified. Or `{ error: "Invalid email or password." }` (401).
**Rate limit**: 5/min per IP, 10/hour per email
**Enumeration-safe**: identical 401 response for wrong email, wrong password, non-admin role, or inactive account
**Roles**: accepts both `admin` and `super_admin`

### POST /api/auth/mfa/verify
**Body**: `{ challengeId, code }` (6-digit code)
**Response**: `{ user: { id, email, name, role }, attemptsLeft }` (200) — sets session cookie. Or `{ error }` (401 — wrong/expired code; 429 — too many attempts, locked).
**Rate limit**: 10/min per IP
**Security**: 5-attempt lockout per challenge, single-use (consumed flag), 5-minute TTL

### POST /api/auth/mfa/resend
**Body**: `{ challengeId }`
**Response**: `{ challengeId, delivered, resendAvailableIn }` (200). Or 429 (cooldown or rate limit).
**Rate limit**: 3 per 10 min per IP, 30s cooldown between resends

### POST /api/auth/logout
Destroys the current session.
**Response**: `{ ok: true }`
**Rate limit**: 20/min per admin

### GET /api/auth/session
Check current session.
**Response**: `{ user: AdminUserPublic | null }`
**Cache**: `no-store`

### POST /api/auth/change-password
**Body**: `{ currentPassword, newPassword }`
**Response**: `{ ok: true }` (200) or `{ error }` (400/403)
**Side effects**: Rotates session ID (transactional), revokes all other sessions
**Rate limit**: 3 per 10 min

## Admin-Only Endpoints

All require a valid admin session cookie.

### Announcements CRUD
- `POST /api/announcements` - create (title, type, body, image, links, pinned)
- `PATCH /api/announcements/[id]` - update (any of: title, type, body, image, links, pinned)
- `DELETE /api/announcements/[id]` - delete
- `GET /api/announcements/export` - CSV export (csvEscape applied to every cell)

**Links field**: array of `{ url, label }` objects, max 10 per announcement. URLs must be http/https (javascript:, data:, file: rejected). Label defaults to hostname if empty.

### Officers CRUD
- `POST /api/officers` - create (yearId, name?, role?, image?)
- `PATCH /api/officers/[id]` - update name/role/image/sortOrder
- `DELETE /api/officers/[id]` - delete (with AlertDialog confirmation)

### Admin Years CRUD
- `POST /api/admin-years` - create (year, theme)
- `PATCH /api/admin-years/[id]` - update year/theme/sortOrder
- `DELETE /api/admin-years/[id]` - delete (cascades officers, with confirmation)

### Contact Messages
- `GET /api/contact` - list all messages (newest first, take 200)
- `PATCH /api/contact/[id]` - update status (new/read/resolved/archived)
- `DELETE /api/contact/[id]` - delete (with AlertDialog confirmation)
- `POST /api/contact/[id]/reply` - send a reply email via SMTP
  - **Body**: `{ replyBody, subject? }`
  - **Response**: `{ ok: true, messageId, item: { id, status } }` (200) or `{ error }` (502 on SMTP failure)
  - **Side effects**: marks message as "resolved" on success; does NOT change status on failure
  - **Rate limit**: 10/hour per admin

### Sessions
- `GET /api/sessions` - list active sessions (returns SHA-256 surrogate IDs, never raw tokens)
- `DELETE /api/sessions/[id]` - revoke a session (cannot revoke current; with confirmation)
  - **Rate limit**: 10/min per admin (bounds DB load from surrogate-id probing)

### Activity Log
- `GET /api/activity` - paginated log (cursor-based, 50 per page)
- `GET /api/activity/export` - CSV export (500 most recent, csvEscape applied)
  - **Rate limit**: 5/min per admin (bounds DB/CPU amplification)

### Announcements Export
- `GET /api/announcements/export` - CSV export (500 most recent, csvEscape applied)
  - **Rate limit**: 5/min per admin (bounds DB/CPU amplification)

### Image Upload
- `POST /api/upload` - multipart form data (file + bucket: officer|announcement)
  - **9-layer defense**: admin-only, rate-limited, Content-Length pre-check, magic-byte detection (file-type), allowlist (JPEG/PNG/WebP only), sharp re-encode to WebP (strips EXIF + payloads), server-generated UUID filename, path traversal re-check, dimension cap (max 2000x2000)
  - **Storage**: Supabase Storage in prod, local filesystem in dev
  - **Response**: `{ url, filename, width, height, bytes }` (201)
  - **Rate limit**: 10/min per admin
  - **Max file size**: 8MB

### Integrations - Email
- `GET /api/integrations/email/status` - returns SMTP config status (configured, fromName, fromEmail, host, port). Does NOT expose SMTP_PASS.
- `POST /api/integrations/email/test` - sends a test email. Optional `{ to }` body (defaults to admin's email).
  - **Rate limit**: 5/hour per admin

### Integrations - Webhook + Outbound APIs
Full integration management for webhook + outbound_api (Discord, Google Workspace, Facebook, Google Forms). Secrets are stored opaquely server-side and never returned to the client (only a masked preview).

- `GET /api/integrations` - returns the full integration catalog merged with stored config + masked secrets.
  - **Response**: `{ items: IntegrationStatus[] }` where each item has `{ id, label, desc, icon, kind, enabled, secretPreview, config, updatedAt }`
- `PUT /api/integrations/[id]` - upsert an integration (enable/disable + config + secret).
  - **Body**: `{ enabled: boolean, config?: Record<string,string>, secret?: string }`
  - Webhook: secret is server-generated (HMAC signing key). Outbound: admin-supplied credential (stored opaquely).
  - Toggling `enabled` without config preserves the stored config + secret.
  - **Rate limit**: 30/min per admin
- `DELETE /api/integrations/[id]` - disables + clears stored credentials (revokes a leaked key).
- `POST /api/integrations/[id]` - rotate the webhook signing key (webhook only). Returns the new raw secret once (never retrievable again).
- `POST /api/integrations/[id]/test` - test connection.
  - Webhook: enables the integration + returns the signing key + publish URL (first enable only).
  - Outbound: validates config + attempts a live connectivity check (Discord: GET /users/@me; others: shape-validation only, degrades gracefully on network block).
  - **Rate limit**: 10/min per admin

### POST /api/webhook/publish (PUBLIC, HMAC-signed)
Auto-publishes an announcement from an external system. **Authorization is the HMAC signature, not an admin session** — this is the only state-changing endpoint exempt from the CSRF origin check.

**Headers**: `x-aoc-signature: <hex HMAC-SHA256>`, `x-aoc-timestamp: <epoch s or ms>`
**Body**: `{ title, body, type?, links?, pinned?, date? }` (links follow the same `{url,label}[]` schema as announcements, re-validated server-side)
**Signature**: `HMAC-SHA256(secret, "${timestamp}.${rawBody}")` — the timestamp is bound to the payload (replay protection, 5-min window).
**Response**: `{ item: Announcement }` (201) or `{ error }` (401 invalid/missing signature, 400 invalid payload)
**Rate limit**: 30/min per IP (before signature verification, bounds brute-force)
**Audit**: logged with synthetic `userId: "webhook"` actor
**Security**: rate-limited per IP before sig verify; timestamp freshness (replay protection); timing-safe signature compare; full payload validation (title 5-200, body 10-5000, type allowlist, links http/https only)

## Admin Account Management (super_admin only)

### GET /api/admin-users
List all admin accounts with role, active status, and last-active time.
**Auth**: any admin (`admin` or `super_admin`)
**Response**: `{ items: AdminUserEntry[], viewerIsSuperAdmin: boolean }`
**Rate limit**: 30/min per admin

### PATCH /api/admin-users/[id]
Activate or deactivate an admin account.
**Auth**: `super_admin` only (403 for regular admins)
**Body**: `{ active: boolean }`
**Response**: `{ ok: true, id, active }` (200)
**Guards**: cannot target self (409); cannot target another super_admin (409); no-op if already in that state (409)
**Side effects**: deactivation purges all sessions + MFA challenges for the target
**Rate limit**: 20/min per super_admin

### DELETE /api/admin-users/[id]
Permanently delete an admin account.
**Auth**: `super_admin` only
**Response**: `{ ok: true }` (200)
**Guards**: cannot target self (409); cannot target another super_admin (409)
**Side effects**: transactional removal of sessions, MFA challenges, and the user
**Rate limit**: 20/min per super_admin
**UI**: double-confirmation — requires typing the admin's email to arm the delete button

## Admin Invites

### GET /api/admin-invites
List all invites (active, used, revoked, expired).
**Auth**: any admin
**Response**: `{ items: InviteView[], viewerIsSuperAdmin: boolean }`
**Rate limit**: 30/min per admin

### POST /api/admin-invites
Create a single-use invite link for a new admin.
**Auth**: `super_admin` only (403 for regular admins)
**Body**: `{ email, ttlDays? }` (role is hardcoded to `admin`)
**Response**: `{ invite: { id, email, role, expiresAt, createdAt }, token }` (201) — the token is shown once
**Rate limit**: 5/hr per super_admin + 10/hr per IP
**Guards**: rejects if email is already an admin (409); rejects if 20 pending invites exist (409)

### DELETE /api/admin-invites/[id]
Revoke a pending invite.
**Auth**: `super_admin` only
**Response**: `{ ok: true }` (200) or 409 (already used/revoked/expired)
**Rate limit**: 20/min per super_admin

### POST /api/admin-invites/redeem
Public endpoint — create an admin account from an invite link.
**Auth**: none (the token is the credential)
**Body**: `{ token, name?, password }` (password min 8 chars)
**Response**: `{ ok: true, email, message }` (200) or `{ error }` (400 — invalid/expired/used/revoked token, weak password)
**Rate limit**: 5/hr per IP
**Security**: single-use (transactional claim guard), invitees always created as `admin` role

## Chatbot

### GET /api/chat
Public status probe.
**Response**: `{ enabled: boolean }`

### POST /api/chat
Public, content-grounded chat.
**Body**: `{ messages: { role: "user"|"assistant", content: string }[] }`
**Response**: `{ reply: string }` (200) or `{ error }` (400/429/502/503)
**Rate limit**: 6/min per IP + 30/hour per IP
**Security**: prompt-injection detection (`isPromptInjection`), abuse detection (`isAbuseRequest`), client system-role messages rejected, output sanitized (code blocks refused, context leaks refused), 20s LLM timeout. Grounded on full site context (announcements, officers, FAQ, policies, contact, socials).

## Error Responses

All errors return:
```json
{ "error": "Human-readable message" }
```

| Status | Meaning |
|--------|---------|
| 400 | Invalid input (validation error) |
| 401 | Not authenticated |
| 403 | Forbidden (CSRF, wrong current password) |
| 404 | Not found |
| 413 | Payload too large (upload > 8MB) |
| 429 | Rate limited (includes Retry-After header) |
| 500 | Server error (generic, no stack trace) |
| 502 | SMTP failure (mapped to user-friendly message) |

## Types

```typescript
interface Announcement {
  id: string;
  type: "award" | "recognition" | "report" | "general";
  title: string;
  body: string;
  image: string | null;
  links: { url: string; label: string }[];
  pinned: boolean;
  date: string; // YYYY-MM-DD
}

interface Officer {
  id: string;
  name: string;
  role: string;
  image: string | null;
  sortOrder: number;
}

interface AdminYear {
  id: string;
  year: string;
  theme: string;
  sortOrder: number;
  officers: Officer[];
}

interface ContactMessage {
  id: string;
  clientId: string;
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
  status: "new" | "read" | "resolved" | "archived";
  createdAt: string; // ISO
}

interface IntegrationStatus {
  id: string;                 // "webhook" | "discord" | "google-workspace" | "facebook" | "google-forms"
  label: string;
  desc: string;
  icon: string;               // Lucide icon name
  kind: "webhook" | "outbound_api";
  enabled: boolean;
  secretPreview: string | null;  // masked (e.g. "…7890"), never the raw secret
  config: Record<string, string>;  // non-secret fields (channelId, calendarId, etc)
  updatedAt: string | null;   // ISO
}
```
