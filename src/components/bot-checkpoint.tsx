"use client";

import * as React from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import { GearLogo } from "@/components/gear-logo";

/**
 * BotCheckpoint - Cloudflare Turnstile gate shown on the initial page load.
 *
 * Flow:
 *   1. On mount, GET /api/verify-bot to check if the visitor already has a
 *      valid signed bot-ok cookie. If yes, render children (no challenge).
 *      This is the "don't re-challenge on refresh" path: the cookie was set
 *      server-side after a prior successful verification.
 *   2. If not verified AND Turnstile is configured, render the Turnstile
 *      widget. On callback, POST the token to /api/verify-bot. On success,
 *      render children.
 *   3. If Turnstile is NOT configured (dev), render children immediately.
 *
 * Per 05-ui-ux-design.md section 6: the checkpoint is a full-screen modal
 * that blocks interaction until resolved. Per 06 section 5: the token is
 * untrusted until server-verified; per section 8: the cookie is server-signed
 * so it can't be forged.
 *
 * The Turnstile widget script is loaded lazily so it only loads when a
 * challenge is actually needed (perf: no third-party JS on every page).
 */

interface BotCheckpointProps {
  children: React.ReactNode;
}

type Status = "checking" | "challenge" | "passed" | "disabled";

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, opts: {
        sitekey: string;
        callback: (token: string) => void;
        "error-callback"?: () => void;
        "expired-callback"?: () => void;
        theme?: "light" | "dark" | "auto";
      }) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

export function BotCheckpoint({ children }: BotCheckpointProps) {
  const [status, setStatus] = React.useState<Status>("checking");
  const [siteKey, setSiteKey] = React.useState<string | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const widgetIdRef = React.useRef<string | null>(null);
  const scriptLoadedRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    async function check() {
      const { data } = await api.get<{ verified: boolean; enabled: boolean }>("/api/verify-bot");
      if (cancelled) return;
      if (!data) {
        setStatus("passed");
        return;
      }
      if (data.verified || !data.enabled) {
        setStatus("passed");
      } else {
        setSiteKey(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null);
        setStatus("challenge");
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

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
    script.onerror = () => {
      setStatus("passed");
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
  }, [status, siteKey]);

  function renderWidget() {
    if (!containerRef.current || !window.turnstile || !siteKey) return;
    if (widgetIdRef.current) {
      try { window.turnstile.remove(widgetIdRef.current); } catch { /* noop */ }
    }
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token) => { void submitToken(token); },
      "error-callback": () => { setError("Verification error. Please retry."); },
      "expired-callback": () => { setError("Verification expired. Please retry."); },
      theme: typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light",
    });
  }

  async function submitToken(token: string) {
    setVerifying(true);
    setError(null);
    const { data, error } = await api.post<{ ok: boolean }>("/api/verify-bot", { token });
    setVerifying(false);
    if (error || !data?.ok) {
      setError(error?.message || "Verification failed. Please retry.");
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.reset(widgetIdRef.current); } catch { /* noop */ }
      }
      return;
    }
    setStatus("passed");
  }

  if (status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Verifying connection…</p>
        </div>
      </div>
    );
  }

  if (status === "passed" || status === "disabled") {
    return <>{children}</>;
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
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              Verifying you&apos;re human
            </h1>
            <p className="text-sm text-muted-foreground">
              We use Cloudflare Turnstile to protect the site from bots and
              automated scraping. Complete the challenge to continue.
            </p>
          </div>
        </div>
        <div ref={containerRef} className="flex justify-center" aria-label="Bot verification challenge" />
        {verifying && (
          <p className="flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Verifying…
          </p>
        )}
        {error && (
          <p role="alert" className="text-center text-sm text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}

export default BotCheckpoint;
