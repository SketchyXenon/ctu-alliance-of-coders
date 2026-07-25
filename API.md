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
**Response**: `{ user: { id, email, name, role } }` (200) or `{ error: "Invalid email or password." }` (401)
**Rate limit**: 5/min per IP, 10/hour per email
**Enumeration-safe**: identical 401 response for wrong email, wrong password, or non-admin role

### POST /api/auth/logout
Destroys the current session.
**Response**: `{ ok: true }`

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

### Activity Log
- `GET /api/activity` - paginated log (cursor-based, 50 per page)
- `GET /api/activity/export` - CSV export (500 most recent, csvEscape applied)

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
```
