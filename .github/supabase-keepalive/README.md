# Supabase Keep-Alive

Supabase pauses free-tier projects after approximately 7 days of inactivity.
This folder documents the scheduled GitHub Actions workflow that keeps the
project awake by pinging its REST API twice a week.

## How it works

The workflow lives at `.github/workflows/supabase-keepalive.yml` (GitHub Actions
only runs workflows from the `.github/workflows/` directory). It runs on the
schedule below and can also be triggered manually.

| Trigger | Schedule | Equivalent (Asia/Manila) |
| --- | --- | --- |
| `schedule` cron | `0 0 * * 2,5` (Tue & Fri 00:00 UTC) | Tue & Fri 08:00 PHT |
| `workflow_dispatch` | Manual | Manual |

Each run issues a single `GET /rest/v1/` request to the Supabase project using
the anon key. The goal is to **prevent inactivity pause**, not to verify auth.
Any HTTP response (2xx, 3xx, or 4xx) proves the project is awake and processing
requests. Only a 5xx response or a connection failure (timeout, DNS error)
indicates the project is paused or down — those fail the run loud (exit 1).

A 401 or 403 response means the project IS awake (it processed the request
and rejected auth) — the run succeeds, but a warning is printed so you know
the anon key may need fixing. The keep-alive still works regardless.

## Required repository secrets

Add these under **Settings > Secrets and variables > Actions** in the GitHub
repository. Do not commit real keys to the repo; secrets are injected at run
time and never appear in logs.

| Secret name | Value | Where to find it |
| --- | --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | Supabase dashboard > Project Settings > API > Project URL |
| `SUPABASE_ANON_KEY` | The `anon` public API key | Supabase dashboard > Project Settings > API > Project API keys (anon / public) |

These map to the app's own `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` environment variables (see `.env.example`).
The anon key is safe to use here: it is the public, RLS-protected key, not the
service-role key.

## Verifying it works

1. After adding the secrets, open the **Actions** tab in GitHub.
2. Select **Keep Supabase Active** in the left sidebar.
3. Click **Run workflow** to trigger it manually.
4. Open the run: the **Query Supabase REST API** step should print
   `Supabase is awake (HTTP <code> = server responded).` and exit 0.

## Troubleshooting HTTP 401

A 401 means the project IS awake (the server responded), but the anon key
was rejected. The keep-alive still succeeds (the project stays unpauseable),
but a warning is printed. Common causes:

1. **Trailing whitespace in the secret** (most common). When you paste a key
   into GitHub's secret UI, a trailing newline or space can be included. The
   workflow now strips all whitespace from both secrets before use, but if
   you still see 401, re-paste the key carefully — make sure no newline is
   copied.

2. **Wrong key type.** Make sure `SUPABASE_ANON_KEY` is the `anon` / `public`
   key, NOT the `service_role` key. The service-role key bypasses RLS and
   should not be committed to CI. Both keys are in Supabase dashboard >
   Project Settings > API > Project API keys.

3. **Wrong project URL.** `SUPABASE_URL` must be
   `https://<project-ref>.supabase.co` (no trailing slash, no `/rest/v1/`
   suffix). The workflow appends `/rest/v1/` automatically.

4. **Key rotated.** If you regenerated the anon key in the Supabase dashboard
   (Project Settings > API > JWT Settings), the old key in the GitHub secret
   is now invalid. Update the secret with the new key.

## Why twice a week

Supabase's free-tier inactivity window is roughly 7 days. A Tuesday + Friday
schedule means the longest gap is ~3 days, well inside the window, with one
retry built in if a single run fails. More frequent runs add no safety and
consume Actions minutes unnecessarily (per 03-software-engineering.md section
10: keep the pipeline fast and cheap).

## Notes

- The workflow uses `concurrency` to avoid overlapping scheduled runs.
- `timeout-minutes: 5` bounds the job so a hung request cannot pile up.
- `--max-time 30` on `curl` ensures a single request cannot hang the step.
- The workflow never logs the anon key value; only the HTTP status is echoed.
