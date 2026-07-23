"use client";

import * as React from "react";
import {
  Award,
  ChevronLeft,
  ChevronRight,
  Clock,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TYPE_ICON: Record<AnnouncementType, LucideIcon> = {
  award: Trophy,
  recognition: Award,
  report: FileText,
  general: Megaphone,
};

export interface AnnouncementModalProps {
  ann: Announcement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  onDelete: (id: string) => void | Promise<void>;
  onEdit?: (ann: Announcement) => void;
  /** Full ordered list the modal is browsing within (enables prev/next). */
  list?: Announcement[];
  /** Called when the user navigates to a different announcement in the list. */
  onNavigate?: (ann: Announcement) => void;
}

/** Split body text into paragraphs on blank lines. */
function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * AnnouncementModal - full-screen reader for a single announcement.
 *
 * Renders inside a shadcn Dialog (Radix). The Dialog handles focus trap and
 * Escape-to-close. We just provide the layout: optional image hero, meta row
 * + title, paragraph body (scrollable), and a footer with close + admin
 * actions.
 */
export function AnnouncementModal({
  ann,
  open,
  onOpenChange,
  isAdmin,
  onDelete,
  onEdit,
  list,
  onNavigate,
}: AnnouncementModalProps) {
  const [deleting, setDeleting] = React.useState(false);

  // Reset the deleting flag whenever the modal closes so reopens start fresh.
  React.useEffect(() => {
    if (!open) setDeleting(false);
  }, [open]);

  // Compute current index in the optional list (for prev/next navigation).
  const hasList = Boolean(list && list.length > 1);
  const currentIndex = React.useMemo(() => {
    if (!ann || !list) return -1;
    return list.findIndex((a) => a.id === ann.id);
  }, [ann, list]);
  const canPrev = hasList && currentIndex > 0;
  const canNext = hasList && currentIndex >= 0 && currentIndex < (list!.length - 1);

  const goPrev = React.useCallback(() => {
    if (canPrev && list && onNavigate) {
      onNavigate(list[currentIndex - 1]);
    }
  }, [canPrev, list, currentIndex, onNavigate]);

  const goNext = React.useCallback(() => {
    if (canNext && list && onNavigate) {
      onNavigate(list[currentIndex + 1]);
    }
  }, [canNext, list, currentIndex, onNavigate]);

  // Keyboard navigation: ArrowLeft/ArrowRight to move between announcements.
  React.useEffect(() => {
    if (!open || !hasList) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hasList, goPrev, goNext]);

  const handleDelete = async () => {
    if (!ann) return;
    setDeleting(true);
    try {
      await onDelete(ann.id);
    } finally {
      setDeleting(false);
      onOpenChange(false);
    }
  };

  const handleEdit = () => {
    if (!ann) return;
    onEdit?.(ann);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby="announcement-modal-desc"
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        {ann ? (
          <AnnouncementModalBody
            ann={ann}
            isAdmin={isAdmin}
            deleting={deleting}
            onDelete={handleDelete}
            onEdit={handleEdit}
            onClose={() => onOpenChange(false)}
            canPrev={canPrev}
            canNext={canNext}
            onPrev={goPrev}
            onNext={goNext}
            position={hasList && currentIndex >= 0 ? `${currentIndex + 1} / ${list!.length}` : null}
          />
        ) : (
          <div className="p-6 text-sm text-muted-foreground">
            No announcement selected.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface AnnouncementModalBodyProps {
  ann: Announcement;
  isAdmin: boolean;
  deleting: boolean;
  onDelete: () => void | Promise<void>;
  onEdit: () => void;
  onClose: () => void;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  position: string | null;
}

function AnnouncementModalBody({
  ann,
  isAdmin,
  deleting,
  onDelete,
  onEdit,
  onClose,
  canPrev,
  canNext,
  onPrev,
  onNext,
  position,
}: AnnouncementModalBodyProps) {
  const badgeCfg = BADGE_CONFIG[ann.type];
  const TypeIcon = TYPE_ICON[ann.type];
  const paragraphs = splitParagraphs(ann.body);
  const wordCount = ann.body.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  const [copied, setCopied] = React.useState(false);

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
      } catch {
        // User cancelled - no action needed.
      }
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(`${ann.title}\n${shareUrl}`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard API not available.
      }
    }
  }

  return (
    <>
      {/* Top accent bar - type-colored, frames the modal (per VLM feedback) */}
      <div className={cn("h-1 w-full shrink-0", badgeCfg.accentBar)} />

      {/* Optional image hero */}
      {ann.image && (
        <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden">
          <img
            src={ann.image}
            alt=""
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-navy-950/70 via-navy-950/15 to-transparent" />
          <Badge
            variant="outline"
            className={cn(
              "absolute left-4 top-4 backdrop-blur-sm",
              badgeCfg.className
            )}
          >
            {badgeCfg.label}
          </Badge>
        </div>
      )}

      {/* Scrollable body */}
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <DialogHeader className="space-y-4 p-6 pb-3 text-left sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            {!ann.image && (
              <span
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-lg",
                  badgeCfg.className
                )}
                aria-hidden="true"
              >
                <TypeIcon className="h-4 w-4" />
              </span>
            )}
            <Badge variant="outline" className={badgeCfg.className}>
              {badgeCfg.label}
            </Badge>
            <time
              dateTime={ann.date}
              className="text-xs font-medium text-muted-foreground"
            >
              {formatDate(ann.date)}
            </time>
            {ann.pinned && (
              <Badge variant="outline" className="badge-pinned gap-1">
                <Pin className="h-3 w-3" aria-hidden="true" />
                Pinned
              </Badge>
            )}
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {readingTime} min read
            </span>
          </div>
          <DialogTitle className="pr-6 font-display text-2xl font-bold leading-tight tracking-tight text-balance sm:text-3xl">
            {ann.title}
          </DialogTitle>
          <DialogDescription id="announcement-modal-desc" className="sr-only">
            Full announcement details
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-8 pt-2 sm:px-8">
          {paragraphs.map((p, i) => (
            <p
              key={i}
              className="text-[0.95rem] leading-7 text-foreground/85 sm:text-base sm:leading-8"
            >
              {p}
            </p>
          ))}
        </div>
      </div>

      {/* Footer - separated with border + muted bg, includes prev/next nav */}
      <DialogFooter className="flex-row items-center justify-between gap-2 border-t bg-muted/40 px-4 py-3 sm:justify-between sm:px-6">
        {/* Left: published date + position indicator */}
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Published {formatDate(ann.date)}
          </span>
          {position && (
            <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-[11px] font-semibold tabular-nums text-muted-foreground ring-1 ring-inset ring-border">
              {position}
            </span>
          )}
        </div>

        {/* Right: prev/next + actions */}
        <div className="flex items-center gap-1.5">
          {/* Prev/Next navigation (only when a list is provided) */}
          {(canPrev || canNext) && (
            <div className="mr-1 flex items-center gap-0.5 border-r border-border pr-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onPrev}
                disabled={!canPrev}
                aria-label="Previous announcement"
                className="h-8 w-8 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onNext}
                disabled={!canNext}
                aria-label="Next announcement"
                className="h-8 w-8 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleShare}
            className="transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
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
              onClick={onEdit}
              className="transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          )}
          {isAdmin && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={deleting}
              className="transition focus-visible:ring-2 focus-visible:ring-destructive active:scale-95 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
          >
            Close
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
