"use client";

import * as React from "react";

/**
 * AnalyticsBeacon - fires a non-blocking page-view beacon on mount.
 *
 * Privacy model (per 06-security-architecture.md section 8 + the site's own
 * cookie-consent copy "We do not use third-party tracking"):
 *   - Respects navigator.doNotTrack (DNT=1) and the Global Privacy Control
 *     header. If either is set, NO beacon is sent.
 *   - No cookie is read or written. The session id is a random string held in
 *     module memory for the page lifetime only — it dies on reload, so we can
 *     group the views of one visit without tracking a user across visits.
 *   - Only path + referrer + session id are sent. The server derives the
 *     visitor hash, device, and country from headers (data minimization).
 *
 * Delivery (per 05-ui-ux-design.md section 6 — non-blocking feedback):
 *   - navigator.sendBeacon is used so the beacon survives navigation and
 *     never blocks the main thread. A fetch fallback covers browsers without
 *     sendBeacon.
 *   - The beacon is fire-and-forget; any failure is silently ignored so
 *     analytics never degrades the UX.
 *
 * Per Z.md: no external analytics SDK.
 */

// In-memory session id for the page lifetime. Regenerated on full reload so it
// cannot be used to track a user across visits. 22 chars of base36 entropy.
const SESSION_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

function doNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const dnt = navigator.doNotTrack;
  const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
  return dnt === "1" || dnt === "yes" || gpc === true;
}

function send(path: string): void {
  if (doNotTrack()) return; // honor the user's opt-out (06 section 8).
  const payload = JSON.stringify({
    path,
    referrer: typeof document !== "undefined" ? document.referrer : null,
    sessionId: SESSION_ID,
  });
  const url = "/api/track";
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // sendBeacon with a Blob sets the right Content-Type + survives navigation.
      const ok = navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      if (ok) return;
    }
    // Fallback: fetch with keepalive (also survives navigation in modern browsers).
    void fetch(url, {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {
      // Silently ignore — analytics must never break the UX.
    });
  } catch {
    // Swallow: a beacon failure is not a user-facing error.
  }
}

/**
 * Fire a page-view beacon on mount. Call once near the top of the app tree
 * (page.tsx). The path is the current pathname; since this is a single-page
 * section-based app, one beacon per mount captures the visit.
 */
export function AnalyticsBeacon() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    send(window.location.pathname + window.location.search);
  }, []);
  return null;
}

export default AnalyticsBeacon;
