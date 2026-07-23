"use client";

import * as React from "react";
import { Cookie, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePageStore } from "@/lib/store";

const CONSENT_KEY = "aoc-cookie-consent-v1";

/**
 * CookieConsent - dismissible banner that appears once until the user
 * accepts or declines. Stores the choice in localStorage. Per the Cookie
 * Policy page, the site only uses local storage for theme + draft state,
 * not ad tracking.
 *
 * Suppressed on admin pages: the admin panel is an authenticated area where
 * the cookie banner would overlap critical controls (sign-in button) on
 * shorter viewports. Admins have already consented by virtue of logging in.
 */
export function CookieConsent() {
  const [visible, setVisible] = React.useState(false);
  const activeNav = usePageStore((s) => s.activeNav);

  const isAdminArea = activeNav === "Admin Panel";

  React.useEffect(() => {
    if (isAdminArea) return;
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      if (!stored) {
        // Small delay so it doesn't flash on initial load.
        const t = window.setTimeout(() => setVisible(true), 1500);
        return () => window.clearTimeout(t);
      }
    } catch {
      // localStorage may be blocked; skip the banner.
    }
  }, [isAdminArea]);

  // Hide immediately when entering admin area.
  React.useEffect(() => {
    if (isAdminArea) setVisible(false);
  }, [isAdminArea]);

  function dismiss(value: "accepted" | "declined") {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch {
      // Best-effort; the banner just won't show again in this session.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
      className={cn(
        "fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md no-print",
        "rounded-xl border border-border bg-card p-4 shadow-lg",
        "animate-[fadeInUp_0.3s_ease-out]"
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold-500/15 text-gold-600 dark:text-gold-400">
          <Cookie className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold text-foreground">
            We use local storage
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            This site stores your theme preference and form drafts locally.
            No third-party tracking cookies. See our Cookie Policy for details.
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
