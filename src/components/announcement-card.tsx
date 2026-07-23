"use client";

import * as React from "react";
import {
  Award,
  FileText,
  Megaphone,
  Pencil,
  Pin,
  Trash2,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import type { Announcement, AnnouncementType } from "@/lib/types";
import { BADGE_CONFIG } from "@/lib/constants";
import { formatDate, truncate } from "@/lib/security";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Map each announcement type to a single Lucide icon for the no-image header. */
const TYPE_ICON: Record<AnnouncementType, LucideIcon> = {
  award: Trophy,
  recognition: Award,
  report: FileText,
  general: Megaphone,
};

const PREVIEW_LEN = 180;
const FEATURED_PREVIEW_LEN = 320;

export interface AnnouncementCardProps {
  ann: Announcement;
  isAdmin: boolean;
  onDelete: (id: string) => void | Promise<void>;
  onEdit?: (ann: Announcement) => void;
  featured?: boolean;
  onOpen: (ann: Announcement) => void;
}

/**
 * Inline admin action buttons (Edit + Delete). Delete defers confirmation to
 * the parent handler - per spec, the parent owns the confirm dialog.
 */
function AdminActions({
  ann,
  isAdmin,
  onDelete,
  onEdit,
}: Pick<AnnouncementCardProps, "ann" | "isAdmin" | "onDelete" | "onEdit">) {
  const [deleting, setDeleting] = React.useState(false);
  if (!isAdmin) return null;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(ann.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Edit announcement: ${ann.title}`}
          onClick={() => onEdit(ann)}
          className="h-8 w-8 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Delete announcement: ${ann.title}`}
        onClick={handleDelete}
        disabled={deleting}
        className="h-8 w-8 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive active:scale-95 disabled:opacity-60"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * AnnouncementCard - a single editorial card in the news feed.
 *
 * Featured cards span two columns on large screens and use a side-by-side
 * image / content layout. Regular cards stack the image above the content.
 */
export function AnnouncementCard({
  ann,
  isAdmin,
  onDelete,
  onEdit,
  featured = false,
  onOpen,
}: AnnouncementCardProps) {
  const badgeCfg = BADGE_CONFIG[ann.type];
  const TypeIcon = TYPE_ICON[ann.type];
  const maxLen = featured ? FEATURED_PREVIEW_LEN : PREVIEW_LEN;
  const isTruncated = ann.body.length > maxLen;
  const preview = isTruncated ? truncate(ann.body, maxLen) : ann.body;

  const open = React.useCallback(() => onOpen(ann), [ann, onOpen]);
  const openLabel = `Open announcement: ${ann.title}`;

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-all duration-200",
        "hover:shadow-lg hover:-translate-y-1",
        "focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring/40",
        featured
          ? "border-gold-300 ring-1 ring-gold-300/50 hover:shadow-gold lg:col-span-2 lg:grid lg:grid-cols-[1.05fr_1fr] lg:items-stretch"
          : "border-border"
      )}
    >
      {/* Visual header (clickable) */}
      <button
        type="button"
        onClick={open}
        aria-label={openLabel}
        className={cn(
          "relative block w-full overflow-hidden border-0 bg-transparent p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          featured
            ? "aspect-[16/9] lg:aspect-auto lg:h-full lg:min-h-[280px]"
            : "aspect-[16/9]"
        )}
      >
        {ann.image ? (
          <>
            <img
              src={ann.image}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-navy-950/70 via-navy-950/15 to-transparent" />
          </>
        ) : (
          <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-navy-700 via-navy-800 to-navy-950">
            <div
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                background:
                  "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.20), transparent 60%)",
              }}
            />
            <TypeIcon
              className={cn(
                "relative text-white/75 transition-transform duration-500 ease-out group-hover:scale-110",
                featured ? "h-16 w-16" : "h-12 w-12"
              )}
              aria-hidden="true"
            />
          </div>
        )}
        <Badge
          variant="outline"
          className={cn("absolute left-3 top-3 backdrop-blur-sm", badgeCfg.className)}
        >
          {badgeCfg.label}
        </Badge>
      </button>

      {/* Content body */}
      <div className={cn("flex flex-1 flex-col gap-3 p-5", featured && "lg:p-7")}>
        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className={badgeCfg.className}>
            {badgeCfg.label}
          </Badge>
          <time dateTime={ann.date} className="font-medium">
            {formatDate(ann.date)}
          </time>
          {ann.pinned && (
            <Badge variant="outline" className="badge-pinned gap-1">
              <Pin className="h-3 w-3" aria-hidden="true" />
              Pinned
            </Badge>
          )}
        </div>

        {/* Title (clickable) */}
        <button
          type="button"
          onClick={open}
          aria-label={openLabel}
          className="-mx-1 rounded-md px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <h3
            className={cn(
              "font-display font-bold tracking-tight text-foreground transition-colors group-hover:text-primary",
              featured ? "text-2xl sm:text-3xl" : "text-lg"
            )}
          >
            {ann.title}
          </h3>
        </button>

        {/* Body preview (truncated) */}
        <p
          className={cn(
            "text-sm leading-relaxed text-muted-foreground",
            featured && "sm:text-base"
          )}
        >
          {preview}
        </p>

        {/* Bottom row: read-full-story + admin actions */}
        <div className="mt-auto flex min-h-[2rem] items-center justify-between gap-2 pt-2">
          {isTruncated ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={open}
              aria-label={`Read full story: ${ann.title}`}
              className="-ml-2 text-primary hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
            >
              Read full story
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground/60" aria-hidden="true">
              &nbsp;
            </span>
          )}
          <AdminActions
            ann={ann}
            isAdmin={isAdmin}
            onDelete={onDelete}
            onEdit={onEdit}
          />
        </div>
      </div>
    </article>
  );
}
