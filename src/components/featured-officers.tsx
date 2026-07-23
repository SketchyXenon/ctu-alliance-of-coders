"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Users, ArrowRight, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AdminYear, SectionKey } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FeaturedOfficersProps {
  adminYears: AdminYear[];
  onNav: (section: SectionKey) => void;
}

/**
 * FeaturedOfficers - highlights the current leadership team on the home page.
 * Shows the latest year's theme + a compact grid of key officers (President,
 * VP, Secretary, Treasurer). Each card shows avatar initials + name + role.
 */
export function FeaturedOfficers({ adminYears, onNav }: FeaturedOfficersProps) {
  const latestYear = React.useMemo(() => {
    if (adminYears.length === 0) return null;
    const sorted = [...adminYears].sort(
      (a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0),
    );
    return sorted[0];
  }, [adminYears]);

  // Pick the 4 key roles to highlight. Use exact match to avoid VP matching President.
  const keyRoles = React.useMemo(() => {
    if (!latestYear) return [];
    const rolePriority = [
      "President",
      "Vice President",
      "Secretary",
      "Treasurer",
    ];
    const seen = new Set<string>();
    const result: typeof latestYear.officers = [];
    for (const role of rolePriority) {
      const officer = latestYear.officers.find(
        (o) =>
          !seen.has(o.id) &&
          o.role?.toLowerCase().trim() === role.toLowerCase(),
      );
      if (officer) {
        result.push(officer);
        seen.add(officer.id);
      }
    }
    // Fill remaining slots with other officers if we have fewer than 4.
    if (result.length < 4) {
      for (const officer of latestYear.officers) {
        if (result.length >= 4) break;
        if (!seen.has(officer.id)) {
          result.push(officer);
          seen.add(officer.id);
        }
      }
    }
    return result.slice(0, 4);
  }, [latestYear]);

  if (!latestYear || keyRoles.length === 0) return null;

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
  };
  const item = {
    hidden: { opacity: 0, y: 12 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
    },
  };

  return (
    <section
      aria-labelledby="featured-officers-heading"
      className="relative mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8"
    >
      {/* Decorative background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute left-1/2 top-0 h-64 w-[600px] -translate-x-1/2 rounded-full bg-gold-500/5 blur-3xl" />
      </div>

      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-px w-6 bg-gold-500" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-600 dark:text-gold-400 font-display">
              Meet the Team
            </span>
          </div>
          <h2
            id="featured-officers-heading"
            className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          >
            Featured Officers
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Leadership for academic year{" "}
            <span className="font-semibold text-foreground">
              {latestYear.year}
            </span>
            {latestYear.theme && (
              <>
                {" "}
                <span className="italic text-foreground/80">
                  &ldquo;{latestYear.theme}&rdquo;
                </span>
              </>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNav("Officers")}
          className="shrink-0"
        >
          <Users className="mr-1.5 h-4 w-4" aria-hidden="true" />
          View all
        </Button>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        {keyRoles.map((officer) => {
          const initials = (officer.name || "?")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((p) => p[0])
            .join("")
            .toUpperCase();
          const isPresident =
            officer.role?.toLowerCase().includes("president") &&
            !officer.role?.toLowerCase().includes("vice");
          return (
            <motion.button
              key={officer.id}
              variants={item}
              type="button"
              onClick={() => onNav("Officers")}
              className={cn(
                "group relative flex flex-col items-center gap-3 rounded-xl border bg-card p-5 text-center",
                "transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:ring-1 hover:ring-gold-300/40",
                isPresident
                  ? "border-gold-300/60 ring-1 ring-gold-300/30"
                  : "border-border hover:border-gold-300/60",
              )}
            >
              {isPresident && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                  <Badge className="gap-1 bg-gold-500 text-navy-950 hover:bg-gold-500">
                    <Crown className="h-3 w-3" aria-hidden="true" />
                    Lead
                  </Badge>
                </span>
              )}
              {/* Avatar */}
              <div
                className={cn(
                  "flex h-16 w-16 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-card",
                  isPresident
                    ? "bg-gradient-to-br from-gold-400 to-gold-600 ring-gold-300"
                    : "bg-gradient-to-br from-navy-700 to-navy-900 ring-gold-400/30",
                )}
              >
                {officer.image ? (
                  <img
                    src={officer.image}
                    alt={officer.name}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <span
                    className={cn(
                      "font-display text-xl font-bold",
                      isPresident ? "text-navy-950" : "text-gold-400",
                    )}
                  >
                    {initials}
                  </span>
                )}
              </div>
              {/* Name + role */}
              <div className="min-w-0">
                <h3 className="truncate font-display text-sm font-semibold text-foreground">
                  {officer.name}
                </h3>
                <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {officer.role}
                </p>
              </div>
              <ArrowRight
                className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 group-hover:text-gold-500"
                aria-hidden="true"
              />
            </motion.button>
          );
        })}
      </motion.div>
    </section>
  );
}
