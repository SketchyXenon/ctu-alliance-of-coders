"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Award,
  FileText,
  Megaphone,
  Trophy,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/security";
import { BADGE_CONFIG } from "@/lib/constants";
import type { Announcement, AnnouncementType, SectionKey } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<AnnouncementType, LucideIcon> = {
  award: Trophy,
  recognition: Award,
  report: FileText,
  general: Megaphone,
};

interface RecentActivityProps {
  announcements: Announcement[];
  onNav: (section: SectionKey) => void;
}

/**
 * RecentActivity - a compact feed of the latest 4 announcements,
 * shown on the home page below the hero. Each item is clickable and
 * navigates to the Announcements section.
 */
export function RecentActivity({ announcements, onNav }: RecentActivityProps) {
  const recent = React.useMemo(
    () =>
      [...announcements]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 4),
    [announcements]
  );

  if (recent.length === 0) return null;

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
  };
  const item = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
  };

  return (
    <section
      aria-labelledby="recent-activity-heading"
      className="relative mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8"
    >
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-px w-6 bg-gold-500" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-600 dark:text-gold-400 font-display">
              Stay Updated
            </span>
          </div>
          <h2
            id="recent-activity-heading"
            className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          >
            Recent Activity
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNav("Announcements")}
          className="shrink-0"
        >
          View all
          <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid gap-4 sm:grid-cols-2"
      >
        {recent.map((ann) => {
          const Icon = TYPE_ICON[ann.type] ?? Megaphone;
          const badge = BADGE_CONFIG[ann.type];
          return (
            <motion.button
              key={ann.id}
              variants={item}
              type="button"
              onClick={() => onNav("Announcements")}
              className={cn(
                "group flex items-start gap-4 rounded-xl border border-border bg-card p-4 text-left",
                "transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:border-gold-300/60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  badge.className
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant="outline" className={cn("text-[10px]", badge.className)}>
                    {badge.label}
                  </Badge>
                  <time
                    dateTime={ann.date}
                    className="text-xs text-muted-foreground"
                  >
                    {formatDate(ann.date)}
                  </time>
                </div>
                <h3 className="font-display text-sm font-semibold leading-snug text-foreground line-clamp-2">
                  {ann.title}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                  {ann.body}
                </p>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-gold-500"
                aria-hidden="true"
              />
            </motion.button>
          );
        })}
      </motion.div>
    </section>
  );
}
