"use client";

import * as React from "react";

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
