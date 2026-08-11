# Supabase Keep-Alive

Supabase pauses free-tier projects after approximately 7 days of inactivity.
This folder documents the scheduled GitHub Actions workflow that keeps the
project awake by pinging its REST API twice a week.

## How it works

The workflow lives at `.github/workflows/supabase-keepalive.yml` (GitHub Actions
only runs workflows from the `.github/workflows/` directory). It runs on the
schedule below and can also be triggered manually.

| Trigger             | Schedule                            | Equivalent (Asia/Manila) |
| ------------------- | ----------------------------------- | ------------------------ |
| `schedule` cron     | `0 0 * * 2,5` (Tue & Fri 00:00 UTC) | Tue & Fri 08:00 PHT      |
| `workflow_dispatch` | Manual                              | Manual                   |

Each run issues a single `GET /rest/v1/` request to the Supabase project using
the anon key. A 2xx response confirms the project is awake. The run fails
loud (exit 1) on any non-2xx response so the failure is visible in the
Actions tab, not silently ignored.

## Required repository secrets

Add these under **Settings > Secrets and variables > Actions** in the GitHub
repository. Do not commit real keys to the repo; secrets are injected at run
time and never appear in logs.

| Secret name         | Value                               | Where to find it                                                               |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `SUPABASE_URL`      | `https://<project-ref>.supabase.co` | Supabase dashboard > Project Settings > API > Project URL                      |
| `SUPABASE_ANON_KEY` | The `anon` public API key           | Supabase dashboard > Project Settings > API > Project API keys (anon / public) |

These map to the app's own `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` environment variables (see `.env.example`).
The anon key is safe to use here: it is the public, RLS-protected key, not the
service-role key.

## Verifying it works

1. After adding the secrets, open the **Actions** tab in GitHub.
2. Select **Keep Supabase Active** in the left sidebar.
3. Click **Run workflow** to trigger it manually.
4. Open the run: the **Query Supabase REST API** step should print
   `Supabase REST API responded with HTTP 200` and exit 0.

## Why twice a week

Supabase's free-tier inactivity window is roughly 7 days. A Tuesday + Friday
schedule means the longest gap is ~3 days, well inside the window, with one
retry built in if a single run fails. More frequent runs add no safety and
consume Actions minutes unnecessarily.

## Notes

- The workflow uses `concurrency` to avoid overlapping scheduled runs.
- `timeout-minutes: 5` bounds the job so a hung request cannot pile up.
- `--max-time 30` on `curl` ensures a single request cannot hang the step.
- The workflow never logs the anon key value; only the HTTP status is echoed.
