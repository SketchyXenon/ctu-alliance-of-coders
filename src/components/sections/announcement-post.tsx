"use client";

import * as React from "react";
import {
  ArrowLeft,
  Award,
  Clock,
  ExternalLink,
  FileText,
  Megaphone,
  Pencil,
  Pin,
  Share2,
  Trash2,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import type { Announcement, AnnouncementType } from "@/lib/types";
import { BADGE_CONFIG } from "@/lib/constants";
import { formatDate } from "@/lib/security";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/section-heading";

const TYPE_ICON: Record<AnnouncementType, LucideIcon> = {
  award: Trophy,
  recognition: Award,
  report: FileText,
  general: Megaphone,
};

/** Split body text into paragraphs on blank lines (mirrors the modal). */
function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export interface AnnouncementPostProps {
  ann: Announcement;
  onBack: () => void;
  isAdmin: boolean;
  onEdit?: (ann: Announcement) => void;
  onDelete?: (id: string) => void | Promise<void>;
  /** Optional prev/next navigation for a blog-like reading flow. */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  position?: string | null; // e.g. "3 / 12"
}
export function AnnouncementPost({
  ann,
  onBack,
  isAdmin,
  onEdit,
  onDelete,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  position,
}: AnnouncementPostProps) {
  const badgeCfg = BADGE_CONFIG[ann.type];
  const TypeIcon = TYPE_ICON[ann.type];
  const paragraphs = splitParagraphs(ann.body);
  const wordCount = ann.body.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onBack();
      } else if (e.key === "ArrowLeft" && hasPrev) {
        e.preventDefault();
        onPrev?.();
      } else if (e.key === "ArrowRight" && hasNext) {
        e.preventDefault();
        onNext?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, onPrev, onNext, hasPrev, hasNext]);

  async function handleShare() {
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    const shareData = {
      title: ann.title,
      text: ann.body.slice(0, 120),
      url: shareUrl,
    };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {}
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(`${ann.title}\n${shareUrl}`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
  }

  return (
    <article
      className="mx-auto w-full max-w-3xl scroll-mt-24 px-4 py-10 sm:px-6 sm:py-12"
      aria-labelledby="announcement-post-title"
    >
      {/* Back row */}
      <div className="mb-6 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 text-muted-foreground hover:text-foreground"
          aria-label="Back to announcements"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          All announcements
        </Button>
        {position && (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-semibold tabular-nums text-muted-foreground">
            {position}
          </span>
        )}
      </div>

      {/* Hero image (optional) */}
      {ann.image && (
        <div className="relative mb-8 aspect-[16/9] w-full overflow-hidden rounded-xl border bg-muted shadow-sm">
          <img src={ann.image} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-navy-950/60 via-transparent to-transparent" />
          <Badge
            variant="outline"
            className={cn(
              "absolute left-3 top-3 backdrop-blur-sm",
              badgeCfg.className,
            )}
          >
            {badgeCfg.label}
          </Badge>
        </div>
      )}

      {/* Header: meta + title */}
      <header className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {!ann.image && (
            <span
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-lg",
                badgeCfg.className,
              )}
              aria-hidden="true"
            >
              <TypeIcon className="h-4 w-4" />
            </span>
          )}
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
          <span className="inline-flex items-center gap-1 font-medium">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {readingTime} min read
          </span>
        </div>
        <h1
          id="announcement-post-title"
          className="font-display text-3xl font-bold leading-tight tracking-tight text-balance sm:text-4xl"
        >
          {ann.title}
        </h1>
      </header>

      {/* Body paragraphs */}
      <div className="space-y-5">
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className="text-[0.975rem] leading-8 text-foreground/85 sm:text-base sm:leading-9"
          >
            {p}
          </p>
        ))}
      </div>

      {/* Specialized links */}
      {ann.links && ann.links.length > 0 && (
        <div className="mt-8 space-y-2 border-t pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Related links
          </p>
          <ul className="space-y-2">
            {ann.links.map((link, i) => (
              <li key={i}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <ExternalLink
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer: prev/next + share + admin actions */}
      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-6">
        <div className="flex items-center gap-1.5">
          {(hasPrev || hasNext) && (
            <div className="mr-1 flex items-center gap-0.5 border-r border-border pr-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPrev}
                disabled={!hasPrev}
                aria-label="Previous announcement"
                className="h-8 px-2.5"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only sm:ml-1">Prev</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onNext}
                disabled={!hasNext}
                aria-label="Next announcement"
                className="h-8 px-2.5"
              >
                <span className="sr-only sm:not-sr-only sm:mr-1">Next</span>
                <ArrowLeft className="h-4 w-4 rotate-180" />
              </Button>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleShare}
            className="h-8"
            aria-label="Share announcement"
          >
            <Share2 className="h-4 w-4" />
            {copied ? "Copied!" : "Share"}
          </Button>
          {isAdmin && onEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onEdit(ann)}
              className="h-8"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          )}
          {isAdmin && onDelete && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => onDelete(ann.id)}
              className="h-8"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground"
        >
          Back to all announcements
        </Button>
      </footer>
    </article>
  );
}
export function AnnouncementNotFound({ onBack }: { onBack: () => void }) {
  return (
    <section className="mx-auto w-full max-w-3xl scroll-mt-24 px-4 py-16 text-center sm:px-6">
      <SectionHeading
        eyebrow="Not found"
        title="Announcement not found"
        sub="This announcement may have been removed or the link is invalid."
        icon="Megaphone"
        iconLabel="Announcements"
      />
      <div className="mt-6">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to announcements
        </Button>
      </div>
    </section>
  );
}
