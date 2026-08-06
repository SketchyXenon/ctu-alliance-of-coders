"use client";

import * as React from "react";
import { Cookie, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePageStore } from "@/lib/store";

const CONSENT_VERSION = 3;
const CONSENT_KEY = "aoc-cookie-consent";

const CONSENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

interface ConsentRecord {
  v: number;
  choice: "accepted" | "declined";
  ts: number;
}

export function CookieConsent() {
  const [visible, setVisible] = React.useState(false);

  const isAdmin = usePageStore((s) => s.isAdmin);

  React.useEffect(() => {
    if (isAdmin) return;
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) {
        const t = window.setTimeout(() => setVisible(true), 1500);
        return () => window.clearTimeout(t);
      }
      // Parse and validate the consent record.
      const parsed = JSON.parse(raw) as Partial<ConsentRecord>;
      const isValid =
        typeof parsed.v === "number" &&
        typeof parsed.choice === "string" &&
        (parsed.choice === "accepted" || parsed.choice === "declined") &&
        typeof parsed.ts === "number" &&
        parsed.v >= CONSENT_VERSION &&
        Date.now() - parsed.ts < CONSENT_TTL_MS;
      if (!isValid) {
        // Stale, invalid, expired, or wrong-version record - re-prompt.
        const t = window.setTimeout(() => setVisible(true), 1500);
        return () => window.clearTimeout(t);
      }
    } catch {
      const t = window.setTimeout(() => setVisible(true), 1500);
      return () => window.clearTimeout(t);
    }
  }, [isAdmin]);

  React.useEffect(() => {
    if (isAdmin) setVisible(false);
  }, [isAdmin]);

  function dismiss(choice: "accepted" | "declined") {
    try {
      const record: ConsentRecord = {
        v: CONSENT_VERSION,
        choice,
        ts: Date.now(),
      };
      localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
    } catch {}
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie consent notice"
      aria-live="polite"
      className={cn(
        "fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md no-print",
        "rounded-xl border border-border bg-card p-4 shadow-lg",
        "animate-[fadeInUp_0.3s_ease-out]",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold-500/15 text-gold-600 dark:text-gold-400">
          <Cookie className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold text-foreground">
            Your privacy choices
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            We use browser cookies to remember your theme preference (light or
            dark) and your consent choice. We do not use third-party tracking,
            advertising, or analytics cookies. See our Cookie Policy for full
            details.
          </p>
        </div>
        <button
          type="button"
          onClick={() => dismiss("declined")}
          className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Dismiss cookie notice"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="flex-1"
          onClick={() => dismiss("accepted")}
        >
          Accept
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => dismiss("declined")}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}
