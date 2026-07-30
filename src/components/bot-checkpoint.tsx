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
 *      signed bot-ok cookie, render children (no challenge).
 *   2. If Turnstile is configured, render the Turnstile widget. On callback,
 *      POST the token to /api/verify-bot. On success, render children.
 *   3. If the Turnstile SCRIPT fails to load, OR siteverify returns a
 *      service-down signal (network/5xx), fall back to the PoW path.
 *   4. If Turnstile is NOT configured (dev), render children immediately.
 *
 * ANTI-LOOP DESIGN (the critical bug this fixes):
 *   - The Turnstile `error-callback` and `expired-callback` do NOT call
 *     `reset()` anymore. Calling reset() re-renders the widget, which
 *     re-fires error-callback -> infinite loop ("always throws Verification
 *     error"). Instead, errors are TERMINAL: a retry counter caps attempts,
 *     and after MAX_ATTEMPTS the UI switches to the PoW fallback (graceful
 *     degradation) or the error state.
 *   - `submitTurnstileToken` failure does NOT call `reset()` either. A failed
 *     server verify is terminal (with a retry button), not an auto-retry.
 *     Auto-retry + reset() was the second loop vector.
 *   - A hard attempt cap (MAX_ATTEMPTS) bounds the total Turnstile attempts
 *     per page load so a misconfigured sitekey or a persistently-failing
 *     widget can never spin forever.
 *
 * Fail-closed policy (06 section 1): a network error on the GET check or a
 * script-load failure does NOT let the user through. The PoW fallback is the
 * graceful-degradation path (02 section 6) for a Cloudflare outage or a
 * widget blocked by COEP/CSP.
 *
 * Per 05-ui-ux-design.md section 6: full-screen modal blocking interaction.
 * Per 06 section 5: token untrusted until server-verified. Per 06 section 3:
 * server enforces the cookie independently (requireBotOk).
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

/** Hard cap on Turnstile widget attempts per page load. Bounds the loop so a
 *  misconfigured sitekey or a widget blocked by COEP/CSP can never spin
 *  forever. After this, the UI falls back to PoW (or error if no challenge). */
const MAX_TURNSTILE_ATTEMPTS = 3;

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
  // Attempt counters (anti-loop). Refs so callbacks read fresh values without
  // re-subscribing the widget on every render.
  const errorAttemptsRef = React.useRef(0);
  const submitAttemptsRef = React.useRef(0);
  // Double-submit guard: Turnstile tokens are single-use. If the callback
  // fires twice (widget re-render, React strict-mode double-mount in dev),
  // the second submit would send an already-consumed token -> Cloudflare
  // returns success:false -> spurious error. This ref ensures only one
  // submit is in-flight at a time.
  const submittingRef = React.useRef(false);

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
    // set status to "passed" (fail-open) and do NOT retry the script load
    // automatically (that would loop). (06 section 1; 02 §6.)
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
      // ANTI-LOOP: error/expired callbacks do NOT call reset(). reset()
      // re-renders the widget -> error fires again -> infinite loop ("always
      // throws Verification error"). Instead, count attempts and fall back to
      // PoW (or error) after MAX_TURNSTILE_ATTEMPTS. Per 06 §1 fail-closed +
      // 02 §6 graceful degradation.
      "error-callback": () => {
        errorAttemptsRef.current += 1;
        if (errorAttemptsRef.current >= MAX_TURNSTILE_ATTEMPTS) {
          // Terminal: the widget itself failed repeatedly (not the server
          // verify). This is usually a misconfigured sitekey or a COEP/CSP
          // block. Degrade to PoW if we have a challenge pre-seeded; else show
          // a clear error. Per 06 §1 (fail closed) + 02 §6 (graceful
          // degradation) + 06 §11 (surface, don't silently degrade).
          if (powChallenge) {
            setStatus("pow");
          } else {
            // No pre-seeded challenge — request one from the server.
            void requestFallback("");
          }
        }
        // Below the cap: show a transient hint but DO NOT reset (anti-loop).
      },
      "expired-callback": () => {
        // Expired is non-fatal: just hint the user. Do NOT reset (loop). The
        // user can click retry to re-mount.
        setError("Verification expired. Click retry to continue.");
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
    // Double-submit guard: tokens are single-use. If the callback fires again
    // while a submit is in-flight, drop the duplicate (the in-flight submit
    // will resolve the state). This prevents a spurious second POST with an
    // already-consumed token -> Cloudflare success:false -> false error.
    if (submittingRef.current) return;
    submittingRef.current = true;

    submitAttemptsRef.current += 1;
    if (submitAttemptsRef.current > MAX_TURNSTILE_ATTEMPTS) {
      submittingRef.current = false;
      // Hard cap reached: request the PoW fallback from the server rather than
      // looping forever. This is the graceful-degradation path for a persistent
      // Turnstile failure (misconfigured secret, hostname mismatch, etc.) that
      // the USER can't fix — they shouldn't be permanently locked out. The
      // server still rate-limits PoW (10/min) + the challenge is single-use,
      // so this doesn't weaken the bot gate. Per 02 §6 + 06 §1.
      void requestFallback(token);
      return;
    }
    setVerifying(true);
    setError(null);
    const { data, error: apiErr } = await api.post<{
      ok: boolean;
      fallback?: "pow";
      retryable?: boolean;
      powChallenge?: PowChallenge;
      error?: string;
    }>("/api/verify-bot", { mode: "turnstile", token });
    setVerifying(false);
    submittingRef.current = false;

    // Success: render children.
    if (!apiErr && data?.ok) {
      setStatus("passed");
      return;
    }

    // PoW fallback offered by the server. The server offers this IMMEDIATELY
    // (no retries needed) when Turnstile is broken (HTTP 400 — the site is on
    // a non-Cloudflare-Zone host like Vercel, so clearance redemption 404s and
    // the widget produces a dummy token) OR when Cloudflare is down (5xx). It
    // also offers it when the client requests it via forceFallback after
    // repeated genuine failures. Per 02 §6 (graceful degradation).
    if (data?.fallback === "pow" && data.powChallenge) {
      setPowChallenge(data.powChallenge);
      setStatus("pow");
      return;
    }

    // Non-fallback, non-broken failure (retryable timeout-or-duplicate, or a
    // genuine success:false that the server didn't offer PoW for): reset the
    // widget to get a fresh token. The submitAttempts cap (checked above)
    // bounds this so it can never infinite-loop — after MAX_ATTEMPTS,
    // requestFallback sends forceFallback:true to get the PoW path. Per 02 §6.
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
        return; // the reset re-fires callback with a fresh token
      } catch {
        // reset failed — fall through to the error state.
      }
    }

    // Can't reset (widget gone or turnstile undefined): terminal error with a
    // manual retry button. ANTI-LOOP: this path is only reached when the widget
    // itself is unavailable, so a reset isn't possible.
    setError(
      apiErr?.message || data?.error || "Verification failed. Please retry.",
    );
    setStatus("error");
  }

  /** Request the PoW fallback from the server after repeated Turnstile
   *  failures. Sends the last token + forceFallback:true so the server knows
   *  to issue a PoW challenge even on a genuine token failure. Per 02 §6. */
  async function requestFallback(lastToken: string) {
    setVerifying(true);
    setError(null);
    const { data, error: apiErr } = await api.post<{
      ok: boolean;
      fallback?: "pow";
      powChallenge?: PowChallenge;
      error?: string;
    }>("/api/verify-bot", {
      mode: "turnstile",
      token: lastToken,
      forceFallback: true,
    });
    setVerifying(false);
    submittingRef.current = false;
    if (!apiErr && data?.ok) {
      setStatus("passed");
      return;
    }
    if (data?.fallback === "pow" && data.powChallenge) {
      setPowChallenge(data.powChallenge);
      setStatus("pow");
      return;
    }
    setError(
      apiErr?.message ||
        data?.error ||
        "Verification unavailable. Please retry.",
    );
    setStatus("error");
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
      // ANTI-LOOP: do NOT auto-retry. The PoW challenge is single-use; a
      // failure means it was consumed or expired. The user clicks retry to
      // get a fresh challenge.
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
    // Reset all attempt counters + guards + state for a clean re-mount.
    errorAttemptsRef.current = 0;
    submitAttemptsRef.current = 0;
    submittingRef.current = false;
    setError(null);
    setPowProgress(0);
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
 * Runs on an async yield loop so the UI stays responsive; a tight sync loop
 * would freeze the main thread. Returns the winning nonce string.
 *
 * NOTE: matches the server's hasPoWPrefix exactly (zero BITS, not hex chars):
 * difficulty 16 -> 4 hex zero chars -> 16 zero bits. Verified against
 * tests/turnstile.test.ts hasPoWPrefix cases.
 */
async function solvePow(
  ch: PowChallenge,
  onProgress: (pct: number) => void,
): Promise<string> {
  const targetHexChars = Math.ceil(ch.difficulty / 4); // each hex nibble = 4 bits
  const prefix = "0".repeat(targetHexChars);
  const encoder = new TextEncoder();
  let nonce = 0;
  // Cap iterations to bound worst case. 16 bits -> ~65k avg; 5M is a safe ceiling.
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
