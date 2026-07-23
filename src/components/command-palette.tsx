"use client";

import * as React from "react";
import {
  Search,
  Home,
  Megaphone,
  Users,
  MessageSquare,
  LayoutDashboard,
  ShieldCheck,
  Database,
  FileText,
  Cookie,
  CornerDownLeft,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SectionKey } from "@/lib/types";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (section: SectionKey) => void;
}

interface CommandItem {
  id: string;
  label: string;
  description: string;
  section: SectionKey;
  icon: LucideIcon;
  keywords: string[];
  group: "Navigate" | "Policies";
}

const COMMANDS: CommandItem[] = [
  { id: "home", label: "Home", description: "Landing page with hero and recent activity", section: "Home", icon: Home, keywords: ["home", "landing", "start"], group: "Navigate" },
  { id: "announcements", label: "Announcements", description: "News, awards, and organization updates", section: "Announcements", icon: Megaphone, keywords: ["news", "announcements", "posts", "updates"], group: "Navigate" },
  { id: "officers", label: "Officers", description: "Leadership team by academic year", section: "Officers", icon: Users, keywords: ["officers", "team", "leadership", "org", "chart"], group: "Navigate" },
  { id: "contact", label: "Contact", description: "Send a message to the admin team", section: "Contact", icon: MessageSquare, keywords: ["contact", "message", "feedback", "support", "help"], group: "Navigate" },
  { id: "admin", label: "Admin Panel", description: "Manage content, inbox, and settings", section: "Admin Panel", icon: LayoutDashboard, keywords: ["admin", "dashboard", "manage", "login"], group: "Navigate" },
  { id: "privacy", label: "Privacy Policy", description: "What data we collect and how we use it", section: "Privacy Policy", icon: ShieldCheck, keywords: ["privacy", "policy", "data", "gdpr"], group: "Policies" },
  { id: "data-protection", label: "Data Protection", description: "How we safeguard your information", section: "Data Protection", icon: Database, keywords: ["data", "protection", "security"], group: "Policies" },
  { id: "terms", label: "Terms of Use", description: "Usage guidelines and agreements", section: "Terms of Use", icon: FileText, keywords: ["terms", "use", "agreement"], group: "Policies" },
  { id: "cookie", label: "Cookie Policy", description: "Local storage and tracking details", section: "Cookie Policy", icon: Cookie, keywords: ["cookie", "tracking", "storage"], group: "Policies" },
];

/**
 * CommandPalette - Cmd+K / Ctrl+K quick navigation dialog.
 * Fuzzy-filters commands by label + keywords. Arrow keys navigate,
 * Enter selects, Escape closes.
 */
export function CommandPalette({ open, onOpenChange, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Reset query + focus input when opened.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Defer focus so the input is mounted.
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((cmd) => {
      const haystack = (cmd.label + " " + cmd.keywords.join(" ")).toLowerCase();
      return haystack.includes(q);
    });
  }, [query]);

  // Reset active index when filter changes.
  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view.
  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) {
        onNavigate(cmd.section);
        onOpenChange(false);
      }
    }
  }

  // Group filtered commands.
  const groups = React.useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const cmd of filtered) {
      const arr = map.get(cmd.group) ?? [];
      arr.push(cmd);
      map.set(cmd.group, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // Flat index for keyboard nav.
  let flatIndex = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Quick navigation to any section</DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[320px] overflow-y-auto scrollbar-thin p-2"
          role="listbox"
          aria-label="Available commands"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No commands found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            groups.map(([group, items]) => (
              <div key={group} className="mb-2 last:mb-0">
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group}
                </div>
                {items.map((cmd) => {
                  flatIndex++;
                  const idx = flatIndex;
                  const Icon = cmd.icon;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => {
                        onNavigate(cmd.section);
                        onOpenChange(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-accent/60"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                          isActive
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium">{cmd.label}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {cmd.description}
                        </span>
                      </span>
                      {isActive && (
                        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">↵</kbd>
            select
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
