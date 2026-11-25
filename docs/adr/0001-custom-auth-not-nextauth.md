# ADR 0001 - Custom cookie-session auth, not next-auth

Status: Accepted
Date: 2026-07-23
Decider: Docs and CI Agent (W4), confirmed against assessment findings H8 and H10.

## Context

The project shipped with `next-auth` listed in package.json but never imported
anywhere. Authentication is implemented by hand in `src/lib/auth.ts`:
AdminUser and AdminSession Prisma models, scrypt password hashing, an
httpOnly + Secure + SameSite session cookie, and session rotation on login
and on password change. The assessment (subagents A and E, finding H8)
flagged next-auth as a dead dependency that also pulled a major-version-stale
package into the supply chain. The custom auth was reviewed and found to be
enumeration-safe (dummy hash plus uniform 401), IDOR-safe on session
endpoints, and to rotate sessions on privilege change (assessment strengths
S2, S3, S4).

06 section 1 says do not build custom crypto or auth primitives - and the
custom auth here uses vetted primitives (node:crypto scrypt, randomUUID for
session ids), not hand-rolled hashing. So the custom auth does not violate
that principle, but it does take on the maintenance burden that next-auth
would normally absorb (MFA, session revocation UI, adapter ecosystem).

## Decision

Remove next-auth from dependencies (done as part of H8) and keep the existing
custom cookie-session auth. Do not introduce next-auth or any other auth
framework unless a concrete requirement (MFA, OAuth, passkeys) forces it.

## Consequences

- We own scrypt hashing, session creation, session rotation, and session
  expiry. Each is small and already implemented; the cost is vigilance, not
  code volume.
- No MFA for admin accounts yet. This is tracked as tech debt item M9; until
  it lands, admin login is single-factor (password + session cookie). 06
  section 2 requires MFA for privileged accounts at minimum, so M9 is a real
  gap, not a nice-to-have.
- No built-in adapter ecosystem. Adding OAuth or passkeys later means writing
  the glue ourselves or revisiting this ADR.
- Trade-off (per 02 section 9): we trade the convenience and auditability of
  a maintained auth framework for a small, readable, dependency-light auth
  layer that matches the project's actual requirements. The cost is
  ongoing maintenance of the primitives and the deferred MFA work.

## Trade-off (explicit, 02 section 9)

Convenience and ecosystem of next-auth vs. simplicity, audit surface, and
dependency count of custom auth. We chose simplicity and lower dependency
count; the price is owning MFA, session revocation UI, and any future OAuth
adapter ourselves.
