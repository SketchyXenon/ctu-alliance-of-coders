# ADR 0004 - Caddyfile transform-port block kept (known SSRF limitation)

Status: Accepted
Date: 2026-07-23
Decider: Docs and CI Agent (W4), based on assessment finding C2.

## Context

The Caddyfile (committed at repo root) listens on :81 and forwards traffic
either to the Next.js app on localhost:3000 (the default `handle` block) or
to any localhost port the client requests via the `?XTransformPort=<port>`
query string (the `@transform_port_query` block). This transform-port
convention is required by the sandbox gateway: mini-services (Python
runtime, websocket examples, future sidecars) register themselves on
arbitrary localhost ports and are reached through this single public
listener.

The assessment (subagent A, finding C2) flagged the
`@transform_port_query` block as a theoretical SSRF risk: any client can
ask the gateway to proxy to any localhost port, which is the textbook
server-side-request-forgery pattern from 06 section 5 (SSRF: server is
tricked into requesting an internal or unintended destination). In a real
multi-tenant deployment this would be a Critical finding; in this
single-tenant sandbox there are no sensitive internal services on other
ports, but the configuration is still wrong as a default and must not be
copied into a multi-tenant deployment unchanged.

## Decision

- Keep the `@transform_port_query` block. It is required by the sandbox
  gateway convention and removing it would break the documented way
  mini-services are reached.
- Add defense-in-depth security headers to the Caddyfile (applied as part
  of C2): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
  disabling camera, microphone, and geolocation, and
  `Strict-Transport-Security` (honored over HTTPS; harmless on the HTTP
  dev listener). The app (src/proxy.ts) also sets these on HTML responses;
  Caddy setting them on everything it proxies is belt-and-suspenders.
- Document the SSRF risk in a comment at the top of the Caddyfile (done)
  and in this ADR, and list it in docs/activity-log.md under "What
  remains" so a future deploy to a real environment does not copy the
  block unchanged.
- In a real multi-tenant deployment, restrict the transform-port query to
  an allowlist of known mini-service ports (Caddy `path_regexp` plus a
  named matcher per port), or put a WAF in front of the gateway that
  blocks the pattern entirely. 06 section 5: allowlist outbound
  destinations; block internal/metadata IP ranges.

## Consequences

- The SSRF surface remains open in the sandbox. Mitigations today are:
  (1) single-tenant sandbox with no sensitive services on other ports;
  (2) app-level rate limiting on auth and contact endpoints in
  src/proxy.ts and the route handlers; (3) the security headers above.
  None of these close the SSRF itself; they limit blast radius.
- Anyone copying this Caddyfile into a multi-tenant deployment inherits
  the SSRF hole. The top-of-file comment and this ADR are the only things
  preventing that - there is no automated guard. A pre-deploy checklist
  item is the realistic mitigation.
- A future task could add a Caddy snippet that maps the transform-port
  query through an allowlist env var (`{$ALLOWED_TRANSFORM_PORTS}`) so the
  same Caddyfile is safe by default in non-sandbox environments. Not yet
  implemented; tracked in docs/activity-log.md.
- Trade-off (per 02 section 9): we trade SSRF safety for sandbox
  convenience. The sandbox needs the transform-port gateway to reach
  mini-services without one Caddyfile edit per service; the price is a
  documented SSRF surface that must be closed before any real deployment.

## Trade-off (explicit, 02 section 9)

SSRF safety vs. sandbox gateway convenience. We chose convenience (the
sandbox requires the transform-port block to reach mini-services); the cost
is an open SSRF surface that is mitigated only by single-tenancy today and
must be allowlisted or WAF-protected before any multi-tenant deployment.
