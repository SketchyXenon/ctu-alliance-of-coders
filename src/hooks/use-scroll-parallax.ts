"use client";

import * as React from "react";

/**
 * useScrollParallax - returns a scroll-based offset value for parallax effects.
 * The offset ranges from 0 (top of page) to ~maxOffset as the user scrolls
 * down. Respects prefers-reduced-motion (always returns 0).
 */
export function useScrollParallax(maxOffset = 80) {
  const [offset, setOffset] = React.useState(0);

  React.useEffect(() => {
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      setOffset(0);
      return;
    }

    let raf = 0;

    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        // Only apply parallax while the hero is roughly in view (first 100vh).
        const clamped = Math.min(scrollY * 0.3, maxOffset);
        setOffset(clamped);
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [maxOffset]);

  return offset;
}
