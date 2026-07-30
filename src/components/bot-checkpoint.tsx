"use client";

import * as React from "react";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { GearLogo } from "@/components/gear-logo";

/**
 * BotCheckpoint - Cloudflare Turnstile gate with a proof-of-work fallback.
 *
 * Flow:
 *   1. On mount, GET /api/verify-bot. If the visitor already has a valid
 *      signed bot-ok cookie, render children (no challenge). This is the
 *      "don't re-challenge on refresh" path.
 *   2. If Turnstile is configured, render the Turnstile widget. On callback,
 *      POST the token to /api/verify-bot. On success, render children.
 *   3. If the Turnstile SCRIPT fails to load, OR siteverify returns a
 *      service-down signal (network/5xx), fall back to the PoW path: solve
 *      the server-issued hashcash challenge client-side, then POST the
 *      solution. On success, render children.
 *   4. If Turnstile is NOT configured (dev), render children immediately.
 *
 * Fail-closed policy (06 section 1): a network error on the GET check or a
 * script-load failure does NOT let the user through. The user sees a retry
 * button. Only the dev/disabled case is fail-open. The PoW fallback is the
 * graceful-degradation path (02 section 6) for a Cloudflare outage.
 *
 * Per 05-ui-ux-design.md section 6: the checkpoint is a full-screen modal
 * that blocks interaction until resolved. Per 06 section 5: the token is
 * untrusted until server-verified; per section 8: the cookie is server-signed
 * so it can't be forged. Per 06 section 3: the server enforces the cookie
 * independently on public write endpoints (requireBotOk).
 */

interface BotCheckpointProps {
  children: React.ReactNode;
}

type Status = "checking" | "challenge" | "pow" | "passed" | "error";

interface PowChallenge {
  challenge: string;
  difficulty: number;
  expiresAt: number;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js";

export function BotCheckpoint({ children }: BotCheckpointProps) {
  const [status, setStatus] = React.useState<Status>("checking");
  const [siteKey, setSiteKey] = React.useState<string | null>(null);
  const [powChallenge, setPowChallenge] = React.useState<PowChallenge | null>(
    null,
  );
  const [verifying, setVerifying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [powProgress, setPowProgress] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const widgetIdRef = React.useRef<string | null>(null);
  const scriptLoadedRef = React.useRef(false);

  // ---- Initial cookie check ------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    async function check() {
      const { data, error: apiErr } = await api.get<{
        verified: boolean;
        enabled: boolean;
        powChallenge?: PowChallenge;
      }>("/api/verify-bot");
      if (cancelled) return;
      // Fail CLOSED: a network error on the check does not let the user
      // through. Show the error state with a retry. (06 section 1.)
      if (apiErr || !data) {
        setError(
          "Couldn't reach the verification service. Please check your connection and retry.",
        );
        setStatus("error");
        return;
      }
      if (data.verified || !data.enabled) {
        setStatus("passed");
        return;
      }
      // Turnstile enabled + not verified: pre-seed the PoW challenge (in case
      // the fallback is needed) and show the Turnstile widget.
      if (data.powChallenge) setPowChallenge(data.powChallenge);
      setSiteKey(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null);
      setStatus("challenge");
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Load + render the Turnstile widget ----------------------------------
  React.useEffect(() => {
    if (status !== "challenge" || !siteKey) return;
    if (scriptLoadedRef.current && window.turnstile) {
      renderWidget();
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      scriptLoadedRef.current = true;
      renderWidget();
    };
    // Fail CLOSED: a script-load failure means Turnstile can't run. Switch to
    // the PoW fallback if we have a challenge, else show an error. We do NOT
    // set status to "passed" (the old fail-open bug). (06 section 1; 02 §6.)
    script.onerror = () => {
      if (powChallenge) {
        setStatus("pow");
      } else {
        setError("Couldn't load the verification widget. Please retry.");
        setStatus("error");
      }
    };
    document.head.appendChild(script);
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // widget already gone; ignore.
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, siteKey, powChallenge]);

  function renderWidget() {
    if (!containerRef.current || !window.turnstile || !siteKey) return;
    if (widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current);
      } catch {
        /* noop */
      }
    }
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token) => {
        void submitTurnstileToken(token);
      },
      // Reset the widget on error/expired so the user can retry (full state
      // set per 05 section 4). The old code only set an error message and
      // left the widget stuck.
      "error-callback": () => {
        setError("Verification error. Please retry.");
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.reset(widgetIdRef.current);
          } catch {
            /* noop */
          }
        }
      },
      "expired-callback": () => {
        setError("Verification expired. Please retry.");
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.reset(widgetIdRef.current);
          } catch {
            /* noop */
          }
        }
      },
      theme:
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark")
          ? "dark"
          : "light",
    });
  }

  // ---- Turnstile submit ----------------------------------------------------
  async function submitTurnstileToken(token: string) {
    setVerifying(true);
    setError(null);
    const { data, error: apiErr } = await api.post<{
      ok: boolean;
      fallback?: "pow";
      powChallenge?: PowChallenge;
      error?: string;
    }>("/api/verify-bot", { mode: "turnstile", token });
    setVerifying(false);
    if (apiErr || !data?.ok) {
      // If the server signalled service-down, switch to the PoW fallback.
      if (data?.fallback === "pow" && data.powChallenge) {
        setPowChallenge(data.powChallenge);
        setStatus("pow");
        return;
      }
      setError(
        apiErr?.message || data?.error || "Verification failed. Please retry.",
      );
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetIdRef.current);
        } catch {
          /* noop */
        }
      }
      return;
    }
    setStatus("passed");
  }

  // ---- PoW fallback (runs when Turnstile script/siteverify is unreachable) -
  React.useEffect(() => {
    if (status !== "pow" || !powChallenge) return;
    let cancelled = false;
    void solvePow(powChallenge, (p) => {
      if (!cancelled) setPowProgress(p);
    })
      .then((nonce) => {
        if (cancelled) return;
        void submitPowSolution(powChallenge.challenge, nonce);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Proof-of-work failed. Please retry.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [status, powChallenge]);

  async function submitPowSolution(challenge: string, nonce: string) {
    setVerifying(true);
    setError(null);
    const { data, error: apiErr } = await api.post<{
      ok: boolean;
      error?: string;
    }>("/api/verify-bot", { mode: "pow", challenge, nonce });
    setVerifying(false);
    if (apiErr || !data?.ok) {
      setError(
        apiErr?.message ||
          data?.error ||
          "Proof-of-work rejected. Please retry.",
      );
      setStatus("error");
      return;
    }
    setStatus("passed");
  }

  function retry() {
    setError(null);
    setPowProgress(0);
    // Re-fetch a fresh state (cookie may have been set by a parallel tab).
    setStatus("checking");
    void (async () => {
      const { data } = await api.get<{
        verified: boolean;
        enabled: boolean;
        powChallenge?: PowChallenge;
      }>("/api/verify-bot");
      if (!data) {
        setError("Couldn't reach the verification service.");
        setStatus("error");
        return;
      }
      if (data.verified || !data.enabled) {
        setStatus("passed");
        return;
      }
      if (data.powChallenge) setPowChallenge(data.powChallenge);
      setSiteKey(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null);
      setStatus("challenge");
    })();
  }

  if (status === "checking") {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2
            className="h-10 w-10 animate-spin text-primary"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">Verifying connection…</p>
        </div>
      </div>
    );
  }

  if (status === "passed") {
    return <>{children}</>;
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-50 via-background to-navy-50 px-4 dark:from-navy-950 dark:via-background dark:to-navy-950">
        <div className="w-full max-w-md space-y-6 rounded-xl border border-border/60 bg-card p-8 shadow-xl">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 ring-2 ring-destructive/20">
              <AlertCircle
                className="h-7 w-7 text-destructive"
                aria-hidden="true"
              />
            </div>
            <h1 className="font-display text-xl font-bold">
              Verification unavailable
            </h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <button
            type="button"
            onClick={retry}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 active:translate-y-0"
          >
            Retry verification
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-50 via-background to-navy-50 px-4 dark:from-navy-950 dark:via-background dark:to-navy-950">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border/60 bg-card p-8 shadow-xl">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/20">
            <GearLogo size={36} />
          </div>
          <div className="space-y-1">
            <h1 className="flex items-center justify-center gap-2 font-display text-xl font-bold">
              <ShieldCheck
                className="h-5 w-5 text-primary"
                aria-hidden="true"
              />
              {status === "pow"
                ? "Checking your browser"
                : "Verifying you're human"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {status === "pow"
                ? "The primary verification service is unreachable. Running a lightweight proof-of-work check so you can continue."
                : "We use Cloudflare Turnstile to protect the site from bots and automated scraping. Complete the challenge to continue."}
            </p>
          </div>
        </div>
        {status === "challenge" && (
          <div
            ref={containerRef}
            className="flex justify-center"
            aria-label="Bot verification challenge"
          />
        )}
        {status === "pow" && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${powProgress}%` }}
                role="progressbar"
                aria-valuenow={Math.round(powProgress)}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Solving… {Math.round(powProgress)}%
            </p>
          </div>
        )}
        {verifying && (
          <p className="flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Verifying…
          </p>
        )}
        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Solve a hashcash-style proof-of-work: find a nonce such that
 * SHA-256(challenge + ":" + nonce) starts with `difficulty` zero bits.
 * Uses the Web Crypto API (built-in, no external lib). Yields progress so
 * the UI can show a bar. Per Z.md: no external libraries unless necessary.
 *
 * Runs on a async yield loop so the UI stays responsive; a tight sync loop
 * would freeze the main thread. Returns the winning nonce string.
 */
async function solvePow(
  ch: PowChallenge,
  onProgress: (pct: number) => void,
): Promise<string> {
  const targetHexChars = Math.ceil(ch.difficulty / 4); // each hex nibble = 4 bits
  const prefix = "0".repeat(targetHexChars);
  const encoder = new TextEncoder();
  let nonce = 0;
  // Sample heuristics: report progress logarithmically. Real solve time is
  // ~10-50ms for 16 bits, but cap iterations to bound worst case.
  const MAX_ITER = 5_000_000;
  const BATCH = 1024;
  while (nonce < MAX_ITER) {
    const nonceStr = nonce.toString(36);
    const data = encoder.encode(`${ch.challenge}:${nonceStr}`);
    // subtle.digest is async; batch small to keep UI responsive.
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hex = bufferToHex(digest);
    if (hex.startsWith(prefix)) {
      onProgress(100);
      return nonceStr;
    }
    nonce++;
    if (nonce % BATCH === 0) {
      // Logarithmic progress estimate (never reaches 100 until solved).
      const est = Math.min(95, 40 + 20 * Math.log10(nonce / BATCH));
      onProgress(est);
      // Yield to the event loop so the progress bar + spinner repaint.
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  throw new Error("PoW iteration cap reached");
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export default BotCheckpoint;
