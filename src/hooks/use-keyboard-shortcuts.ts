"use client";

import * as React from "react";
import type { SectionKey } from "@/lib/types";

const SHORTCUT_MAP: Record<string, SectionKey> = {
  "1": "Home",
  "2": "Announcements",
  "3": "Officers",
  "4": "Contact",
  "5": "Admin Panel",
};

/**
 * useKeyboardShortcuts - global keyboard navigation.
 * Press 1-5 to jump between sections (ignored when typing in an input).
 * Press "t" to toggle theme.
 * Press "?" to show the keyboard shortcuts help dialog.
 */
export function useKeyboardShortcuts(
  onNav: (section: SectionKey) => void,
  onToggleTheme?: () => void,
  onToggleHelp?: () => void
) {
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignore if focus is in an input, textarea, or contenteditable.
      const target = e.target as HTMLElement;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      // Ignore modifier combos (Ctrl+, Cmd+, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const section = SHORTCUT_MAP[e.key];
      if (section) {
        e.preventDefault();
        onNav(section);
        return;
      }

      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        onToggleTheme?.();
        return;
      }

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        onToggleHelp?.();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNav, onToggleTheme, onToggleHelp]);
}
