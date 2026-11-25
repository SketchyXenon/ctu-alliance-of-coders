# ADR-0005: Two-tier admin role model (super_admin + admin)

Date: 2026-08-08

## Context

The admin panel previously had a single `admin` role created exclusively via the `scripts/bootstrap-admin.ts` script. Every admin had identical privileges, including the ability to manage other admin accounts. This created two problems:

1. **No least-privilege separation** (per 06-security-architecture.md §3): a compromised or rogue admin could delete every other admin account, including the one that onboarded them, causing lockout.
2. **No scalable onboarding**: the bootstrap script requires server access (CLI + DATABASE_URL), so creating new admins required a developer with shell access rather than a delegated administrator.

The requirement was to introduce a `super_admin` role that can manage (deactivate/delete) regular admin accounts, while regular admins are onboarded via invite links (not the bootstrap script).

## Decision

Introduce a two-tier role model:

- **`super_admin`** — created exclusively via `bun run bootstrap`. Can manage admin accounts (activate/deactivate/delete) and create/revoke invite links. Cannot be deactivated or deleted by anyone. Cannot manage their own account.
- **`admin`** — created exclusively via invite link redemption. Has full panel access (announcements, officers, inbox, integrations, etc.) except account management and invite creation.

### Enforcement

- `requireAdmin()` accepts both roles (both can use the panel).
- `requireSuperAdmin()` (new) required for `/api/admin-users/[id]` (PATCH + DELETE) and `/api/admin-invites` (POST) + `/api/admin-invites/[id]` (DELETE).
- `requireSuperAdmin()` returns 401 when unauthenticated, 403 when authenticated but insufficient role (distinct from 401 so the UI can show "forbidden" vs "sign in").
- Bootstrap script hardcodes `role: "super_admin"`; the `role` parameter was removed from the invite creation API (invitees are always `admin`).

### Account management guards

- **Self-protection**: a super_admin cannot target their own account (409).
- **Super-admin protection**: a super_admin cannot target another super_admin (409) — only regular admins are manageable. This prevents lockout and privilege escalation.
- **Deactivation**: sets `active=false`, purges all sessions + MFA challenges. Inactive accounts cannot log in (enumeration-safe — same 401 as wrong password).
- **Deletion**: transactional removal of sessions, MFA challenges, and the user.

### Schema change

`AdminUser` gains `active Boolean @default(true)` in both SQLite and Postgres schemas. `getCurrentUser` checks `active === false` and returns null (fail closed), purging the user's sessions.

## Alternatives Considered

1. **Single role with an `isOwner` flag** — rejected: a boolean doesn't model the "cannot be managed by anyone" constraint cleanly, and it conflates role with a mutable flag.
2. **Three roles (super_admin / admin / editor)** — rejected: YAGNI (per 03-software-engineering.md §1). The requirement is account management separation, not content-editing tiers.
3. **NextAuth.js with role-based sessions** — rejected: the project uses custom auth (per ADR-0001), and the role check is a one-line addition to the existing `requireAdmin` flow.

## Consequences

- **Positive**: least-privilege separation; super_admins can deactivate a compromised admin without server access; invite-based onboarding is self-service for super_admins.
- **Positive**: lockout prevention — super_admins cannot delete each other or themselves.
- **Negative**: if all super_admins lose their credentials, recovery requires server access (bootstrap script). This is acceptable: it's the same recovery path as before, and the bootstrap script is documented.
- **Negative**: the `ALLOWED_INVITE_ROLES` constant in `lib/invites.ts` is now unused for role selection (the route hardcodes `admin`). Kept for backwards compatibility in the library, but the route ignores client-supplied roles.

## Security Checklist (per 06 §12)

- [x] Every new endpoint checks authentication AND function-level authorization (`requireSuperAdmin`)
- [x] Object-level authorization: self + super_admin target protection (409)
- [x] Rate limits set on all new endpoints
- [x] Secrets not in code/logs (tokens hashed with SHA-256, emails masked in logs)
- [x] Error responses reveal what the user needs, not internal state
- [x] Security-relevant events logged (activate/deactivate/delete/create/revoke/redeem)
