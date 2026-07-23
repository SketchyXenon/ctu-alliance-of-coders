"use client";

import { cn } from "@/lib/utils";

/**
 * Skeleton primitives for loading states.
 * Uses a shimmer animation to feel alive rather than a static gray block.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "skeleton relative overflow-hidden rounded-md bg-muted",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:animate-[shimmer_1.8s_infinite] before:bg-gradient-to-r",
        "before:from-transparent before:via-foreground/8 before:to-transparent",
        className
      )}
      aria-hidden="true"
    />
  );
}

/** Announcement card skeleton - matches the card grid layout. */
export function AnnouncementCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-0 shadow-sm">
      <Skeleton className="aspect-[16/9] w-full rounded-t-xl" />
      <div className="space-y-3 p-5">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  );
}

/** Officer card skeleton - circular avatar + name/role. */
export function OfficerCardSkeleton() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-5 text-center shadow-sm">
      <Skeleton className="h-24 w-24 rounded-full" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

/** Full announcements section skeleton. */
export function AnnouncementsSkeleton() {
  return (
    <section
      className="px-4 py-16 sm:px-6 lg:px-8"
      role="status"
      aria-busy="true"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-1 w-16 rounded-full" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <AnnouncementCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Officers section skeleton. */
export function OfficersSkeleton() {
  return (
    <section
      className="px-4 py-16 sm:px-6 lg:px-8"
      role="status"
      aria-busy="true"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-1 w-16 rounded-full" />
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <OfficerCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
