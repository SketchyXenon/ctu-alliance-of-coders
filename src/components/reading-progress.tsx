"use client";

import * as React from "react";

/**
 * ReadingProgress - a fixed gold progress bar at the top of the viewport
 * that fills as the user scrolls down the page. Hidden on the hero (Home)
 * since it's a full-viewport section with minimal scroll value.
 */
export function ReadingProgress({ active }: { active: boolean }) {
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (!active) return;

    function onScroll() {
      const scrollTop = window.scrollY;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      setProgress(Math.min(100, Math.max(0, pct)));
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [active]);

  if (!active || progress === 0) return null;

  return (
    <div
      className="reading-progress no-print"
      style={{
        width: `${progress}%`,
        height: "4px",
        background: "linear-gradient(to right, var(--gold-500), var(--gold-300))",
        boxShadow: "0 0 8px rgba(212, 175, 55, 0.5), 0 1px 2px rgba(0, 0, 0, 0.1)",
        borderBottomRightRadius: "2px",
      }}
      aria-hidden="true"
    />
  );
}
