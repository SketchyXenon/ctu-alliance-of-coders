"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { useShallow } from "zustand/react/shallow";
import { Menu, Moon, Search, Sun } from "lucide-react";
import { GearLogo } from "@/components/gear-logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NAV_LINKS } from "@/lib/constants";
import { usePageStore } from "@/lib/store";
import type { SectionKey } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * SiteNav - sticky primary navigation for the Alliance of Coders site.
 *
 * Single-page section model: nav links call `setActiveNav` on the Zustand
 * page store rather than routing. The Admin Panel link surfaces a green
 * "session active" dot when the visitor is signed in as admin, plus a
 * numeric badge for pending contact messages (capped at "9+").
 */
export function SiteNav() {
  const { activeNav, setActiveNav, isAdmin, pendingMessages } = usePageStore(
    useShallow((s) => ({
      activeNav: s.activeNav,
      setActiveNav: s.setActiveNav,
      isAdmin: s.isAdmin,
      pendingMessages: s.pendingMessages,
    })),
  );

  const { resolvedTheme, theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = (resolvedTheme ?? theme) === "dark";
  const pendingCount = pendingMessages.length;
  const pendingLabel = pendingCount > 9 ? "9+" : String(pendingCount);

  const handleNavigate = (key: SectionKey) => {
    setActiveNav(key);
    setMobileOpen(false);
  };

  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full no-print",
        "border-b border-border/60",
        "bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65",
        "shadow-[0_1px_0_0_rgba(10,36,112,0.06)] dark:shadow-[0_1px_0_0_rgba(0,0,0,0.4)]",
      )}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8"
      >
        {/* Brand */}
        <Button
          variant="ghost"
          onClick={() => handleNavigate("Home")}
          aria-label="Alliance of Coders - back to home"
          className={cn(
            "group h-auto items-center gap-3 rounded-md px-2 py-1.5",
            "hover:bg-transparent hover:text-foreground",
            "focus-visible:bg-transparent focus-visible:text-foreground",
          )}
        >
          <GearLogo
            size={36}
            spinOnHover
          />
          <span className="flex flex-col items-start leading-tight">
            <span className="font-display text-base font-bold tracking-tight text-foreground">
              Alliance of Coders
            </span>
            <span className="text-[0.65rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              CTU Danao Campus
            </span>
          </span>
        </Button>

        {/* Desktop links + theme toggle */}
        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const isActive = activeNav === link.key;
            const isAdminLink = link.key === "Admin Panel";
            const showDot = isAdminLink && isAdmin;
            const showBadge = isAdminLink && pendingCount > 0;

            return (
              <Button
                key={link.key}
                variant="ghost"
                size="sm"
                onClick={() => handleNavigate(link.key)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group relative h-9 px-3 text-sm font-medium transition-colors",
                  "hover:bg-transparent focus-visible:bg-transparent",
                  isActive
                    ? "text-gold-600 dark:text-gold-300"
                    : "text-foreground/80 hover:text-gold-600 dark:hover:text-gold-300 focus-visible:text-gold-600 dark:focus-visible:text-gold-300",
                )}
              >
                <span className="relative inline-flex items-center gap-2">
                  {showDot && (
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)] dark:bg-emerald-400 dark:shadow-[0_0_0_3px_rgba(52,211,153,0.22)]"
                    />
                  )}
                  {link.label}
                  {showBadge && (
                    <span
                      aria-label={`${pendingCount} pending message${pendingCount === 1 ? "" : "s"}`}
                      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-500 px-1 text-[0.625rem] font-bold leading-none text-navy-900 ring-2 ring-background"
                    >
                      {pendingLabel}
                    </span>
                  )}
                </span>
                {/* Gold underline indicator */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-x-3 bottom-1 h-0.5 origin-left rounded-full bg-gold-500 transition-transform duration-200 ease-out",
                    isActive ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100",
                  )}
                />
              </Button>
            );
          })}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Dispatch a custom event the page listens for.
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
            }}
            className="ml-2 hidden items-center gap-2 text-muted-foreground lg:inline-flex"
            aria-label="Open command palette"
          >
            <Search className="size-4" aria-hidden="true" />
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
              ⌘K
            </kbd>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
            }}
            className="hidden text-muted-foreground hover:text-foreground lg:inline-flex"
            aria-label="Show keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium">
              ?
            </kbd>
          </Button>

          <ThemeToggle
            mounted={mounted}
            isDark={isDark}
            onToggle={toggleTheme}
          />
        </div>

        {/* Mobile hamburger + theme toggle */}
        <div className="flex items-center gap-1 md:hidden">
          {/* Theme toggle icon in header (05 §4: visible without opening menu) */}
          <ThemeToggle
            mounted={mounted}
            isDark={isDark}
            onToggle={toggleTheme}
            iconOnly
          />
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation menu"
                aria-expanded={mobileOpen}
                aria-controls="mobile-nav-content"
                className="text-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              id="mobile-nav-content"
              side="right"
              className="w-[88vw] gap-0 border-l border-border p-0 sm:max-w-sm"
            >
              <SheetHeader className="gap-1 border-b border-white/10 bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 p-5 text-left">
                <SheetTitle className="flex items-center gap-3 font-display text-base font-bold text-white">
                  <GearLogo size={36} />
                  <span className="flex flex-col leading-tight">
                    <span>Alliance of Coders</span>
                    <span className="text-[0.65rem] font-medium uppercase tracking-[0.16em] text-gold-300">
                      CTU Danao Campus
                    </span>
                  </span>
                </SheetTitle>
                <SheetDescription className="text-white/70">
                  Navigate the Alliance of Coders site
                </SheetDescription>
              </SheetHeader>

              <div
                className="flex flex-1 flex-col gap-1 overflow-y-auto p-4"
                role="menu"
              >
                {NAV_LINKS.map((link) => {
                  const isActive = activeNav === link.key;
                  const isAdminLink = link.key === "Admin Panel";
                  const showDot = isAdminLink && isAdmin;
                  const showBadge = isAdminLink && pendingCount > 0;

                  return (
                    <Button
                      key={link.key}
                      variant="ghost"
                      role="menuitem"
                      onClick={() => handleNavigate(link.key)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "h-12 justify-start gap-3 rounded-md px-4 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-accent text-gold-700 dark:bg-accent/40 dark:text-gold-300"
                          : "text-foreground/85 hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      {showDot && (
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full bg-emerald-500 dark:bg-emerald-400"
                        />
                      )}
                      <span>{link.label}</span>
                      {showBadge && (
                        <span
                          aria-label={`${pendingCount} pending message${pendingCount === 1 ? "" : "s"}`}
                          className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-500 px-1.5 text-[0.625rem] font-bold leading-none text-navy-900"
                        >
                          {pendingLabel}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}

interface ThemeToggleProps {
  mounted: boolean;
  isDark: boolean;
  onToggle: () => void;
  className?: string;
  full?: boolean;
  iconOnly?: boolean;
}

/**
 * ThemeToggle - accessible light/dark switch using next-themes.
 * Renders a stable placeholder until mounted to avoid hydration mismatch
 * (server has no knowledge of the user's resolved theme).
 * - `full`: wide button with label (used in mobile Sheet, now removed).
 * - `iconOnly`: compact icon button for the mobile header bar (05 §4).
 */
function ThemeToggle({
  mounted,
  isDark,
  onToggle,
  className,
  full,
  iconOnly,
}: ThemeToggleProps) {
  if (!mounted) {
    if (iconOnly) {
      return (
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-9 text-muted-foreground", className)}
          aria-label="Toggle theme"
        >
          <span className="size-4 rounded-full border border-current opacity-30" />
        </Button>
      );
    }
    return (
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "h-9 gap-2 border-border bg-background/60",
          full && "w-full justify-between px-4",
          className,
        )}
        aria-label="Toggle theme"
      >
        <span className="size-4 rounded-full border border-current opacity-30" />
        <span className="text-sm font-medium opacity-60">Theme</span>
      </Button>
    );
  }

  if (iconOnly) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        className={cn(
          "size-9 text-muted-foreground",
          "transition-colors hover:bg-accent hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-gold-400/40",
          className,
        )}
      >
        {isDark ? (
          <Sun className="size-5 text-gold-500" aria-hidden="true" />
        ) : (
          <Moon className="size-5 text-navy-700" aria-hidden="true" />
        )}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onToggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={cn(
        "h-9 gap-2 border-border bg-background/60",
        "transition-colors hover:border-gold-400 hover:bg-accent hover:text-accent-foreground",
        "focus-visible:border-gold-400 focus-visible:ring-gold-400/40",
        full && "w-full justify-between px-4",
        className,
      )}
    >
      {isDark ? (
        <>
          <Sun className="size-4 text-gold-500" aria-hidden="true" />
          <span className="text-sm font-medium">Light</span>
        </>
      ) : (
        <>
          <Moon className="size-4 text-navy-700" aria-hidden="true" />
          <span className="text-sm font-medium">Dark</span>
        </>
      )}
    </Button>
  );
}
