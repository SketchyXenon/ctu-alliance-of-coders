"use client";

import * as React from "react";

/**
 * useCountUp - animates a number from 0 to `target` over `duration` ms.
 * Uses requestAnimationFrame with an ease-out cubic curve.
 * Respects prefers-reduced-motion (jumps to target instantly).
 */
export function useCountUp(target: number, duration = 1200, startDelay = 200) {
  const [value, setValue] = React.useState(0);
  const reducedMotion = React.useRef(false);

  React.useEffect(() => {
    reducedMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion.current) {
      setValue(target);
      return;
    }

    let raf = 0;
    let startTime = 0;

    const timer = window.setTimeout(() => {
      const animate = (now: number) => {
        if (startTime === 0) startTime = now;
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out cubic: 1 - (1 - t)^3
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(target * eased));
        if (progress < 1) {
          raf = requestAnimationFrame(animate);
        }
      };
      raf = requestAnimationFrame(animate);
    }, startDelay);

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, duration, startDelay]);

  return value;
}
