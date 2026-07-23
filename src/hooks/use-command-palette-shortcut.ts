"use client";

import * as React from "react";

/**
 * useCommandPaletteShortcut - listens for Cmd+K / Ctrl+K globally.
 * Works even when focus is in an input (unlike the number shortcuts).
 * Toggles the `onToggle` callback.
 */
export function useCommandPaletteShortcut(onToggle: () => void) {
  const callbackRef = React.useRef(onToggle);

  React.useEffect(() => {
    callbackRef.current = onToggle;
  }, [onToggle]);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        callbackRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
