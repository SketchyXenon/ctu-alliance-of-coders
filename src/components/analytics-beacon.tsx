"use client";

import * as React from "react";

const SESSION_ID =
  Math.random().toString(36).slice(2) + Date.now().toString(36);

function doNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const dnt = navigator.doNotTrack;
  const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean })
    .globalPrivacyControl;
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
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const ok = navigator.sendBeacon(
        url,
        new Blob([payload], { type: "application/json" }),
      );
      if (ok) return;
    }

    void fetch(url, {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function AnalyticsBeacon({ section }: { section: string }) {
  React.useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = localStorage.getItem("aoc-cookie-consent");
      const rec = raw ? (JSON.parse(raw) as { choice?: string }) : null;
      if (!rec || rec.choice !== "accepted") return;
    } catch {
      return;
    }
    const base = window.location.pathname + window.location.search;
    const path =
      section && section !== "Home"
        ? `${base}${base.includes("?") ? "&" : "?"}section=${encodeURIComponent(section)}`
        : base;
    send(path);
  }, [section]);
  return null;
}

export default AnalyticsBeacon;
