"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface ShortcutHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Shortcut {
  keys: string;
  description: string;
  group: "Navigation" | "Actions";
}

const SHORTCUTS: Shortcut[] = [
  { keys: "1", description: "Go to Home", group: "Navigation" },
  { keys: "2", description: "Go to Announcements", group: "Navigation" },
  { keys: "3", description: "Go to Officers", group: "Navigation" },
  { keys: "4", description: "Go to Contact", group: "Navigation" },
  { keys: "5", description: "Go to Admin Panel", group: "Navigation" },
  { keys: "⌘ K", description: "Open command palette", group: "Actions" },
  { keys: "?", description: "Show this help dialog", group: "Actions" },
  { keys: "T", description: "Toggle dark / light theme", group: "Actions" },
  { keys: "Esc", description: "Close dialogs", group: "Actions" },
];

/**
 * ShortcutHelp - a dialog showing all available keyboard shortcuts.
 * Opened with the "?" key.
 */
export function ShortcutHelp({ open, onOpenChange }: ShortcutHelpProps) {
  const groups = React.useMemo(() => {
    const map = new Map<string, Shortcut[]>();
    for (const s of SHORTCUTS) {
      const arr = map.get(s.group) ?? [];
      arr.push(s);
      map.set(s.group, arr);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Use these keys to navigate the site faster.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {groups.map(([group, items]) => (
            <div key={group}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </h3>
              <ul className="space-y-1.5">
                {items.map((s) => (
                  <li
                    key={s.keys}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-sm text-foreground">{s.description}</span>
                    <kbd className="shrink-0 rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground shadow-sm">
                      {s.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
