"use client";

import * as React from "react";
import {
  Award,
  Briefcase,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Code2,
  Mail,
  Megaphone,
  Wallet,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Officer } from "@/lib/types";

interface OfficerModalProps {
  officer: Officer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Academic year label the officer served (e.g. "2024-2025"). */
  yearLabel?: string;
  /** Full ordered list of officers (enables prev/next navigation). */
  list?: Officer[];
  /** Called when the user navigates to a different officer in the list. */
  onNavigate?: (officer: Officer) => void;
}

/** Role-to-icon matching lives in the RoleIcon component below (kept inline
 *  so the react-hooks/static-components lint rule is satisfied). */

/**
 * OfficerModal - detail view for a single officer.
 * Shows large avatar, name, role icon, year served, and a generated bio.
 * Supports prev/next navigation when a list is provided (parity with
 * the announcement modal).
 */
export function OfficerModal({
  officer,
  open,
  onOpenChange,
  yearLabel,
  list,
  onNavigate,
}: OfficerModalProps) {
  // Compute current index for prev/next navigation.
  const hasList = Boolean(list && list.length > 1);
  const currentIndex = React.useMemo(() => {
    if (!officer || !list) return -1;
    return list.findIndex((o) => o.id === officer.id);
  }, [officer, list]);
  const canPrev = hasList && currentIndex > 0;
  const canNext = hasList && currentIndex >= 0 && currentIndex < (list!.length - 1);

  const goPrev = React.useCallback(() => {
    if (canPrev && list && onNavigate) onNavigate(list[currentIndex - 1]);
  }, [canPrev, list, currentIndex, onNavigate]);

  const goNext = React.useCallback(() => {
    if (canNext && list && onNavigate) onNavigate(list[currentIndex + 1]);
  }, [canNext, list, currentIndex, onNavigate]);

  // Keyboard navigation: ArrowLeft/ArrowRight.
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

  const position = hasList && currentIndex >= 0 ? `${currentIndex + 1} / ${list!.length}` : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        {officer ? (
          <OfficerModalBody
            officer={officer}
            yearLabel={yearLabel}
            position={position}
            canPrev={canPrev}
            canNext={canNext}
            onPrev={goPrev}
            onNext={goNext}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <div className="p-6 text-sm text-muted-foreground">No officer selected.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface OfficerModalBodyProps {
  officer: Officer;
  yearLabel?: string;
  position: string | null;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

function OfficerModalBody({
  officer,
  yearLabel,
  position,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onClose,
}: OfficerModalBodyProps) {
  const displayName = officer.name?.trim() || "Vacant Slot";
  const displayRole = officer.role?.trim() || "Open Position";
  const isVacant = !officer.name?.trim();
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  const roleDescription = getRoleDescription(displayRole);

  return (
    <>
      {/* Top accent bar - navy-to-gold gradient, frames the modal */}
      <div className="h-1.5 w-full shrink-0 bg-gradient-to-r from-navy-700 via-navy-600 to-gold-500" />

      {/* Hero header with decorative background */}
      <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-navy-700 to-navy-900 px-6 pb-6 pt-8 text-center">
        {/* Decorative gold glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-12 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-gold-400/15 blur-3xl"
        />
        <DialogHeader className="relative z-10 space-y-0 text-center">
          <DialogTitle className="sr-only">{displayName}</DialogTitle>
          <DialogDescription className="sr-only">
            Officer details for {displayName}
          </DialogDescription>
        </DialogHeader>

        {/* Large avatar */}
        <div className="relative z-10 mx-auto h-28 w-28 shrink-0">
          {officer.image ? (
            <Image
              src={officer.image}
              alt={`${displayName} portrait`}
              fill
              sizes="112px"
              className="rounded-full object-cover ring-4 ring-gold-400/40 ring-offset-2 ring-offset-navy-800"
            />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-navy-600 to-navy-950 ring-4 ring-gold-400/40 ring-offset-2 ring-offset-navy-800">
              <span className="font-display text-3xl font-bold text-gold-400">
                {isVacant ? "?" : initials || "?"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5 text-center">
        {/* Name + role */}
        <h2 className="font-display text-2xl font-bold leading-tight tracking-tight text-foreground text-balance">
          {displayName}
        </h2>

        {/* Role badge with icon */}
        <div className="mt-2 flex items-center justify-center gap-1.5">
          <Badge
            variant="outline"
            className="gap-1.5 border-gold-300/60 bg-gold-500/10 py-1 text-gold-700 dark:text-gold-300"
          >
            <RoleIcon role={displayRole} />
            {displayRole}
          </Badge>
        </div>

        {/* Year served chip */}
        {yearLabel && (
          <div className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 text-gold-500" aria-hidden="true" />
            <span>Served academic year</span>
            <span className="font-semibold text-foreground">{yearLabel}</span>
          </div>
        )}

        {/* Decorative gold divider */}
        <div className="mx-auto mt-4 h-0.5 w-12 rounded-full bg-gradient-to-r from-gold-500 to-gold-300" />

        {/* Role description */}
        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {roleDescription}
        </p>

        {/* Contact hint */}
        {!isVacant && (
          <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            Reach out via the Contact section
          </p>
        )}
      </div>

      {/* Footer - prev/next nav + close */}
      <DialogFooter className="flex-row items-center justify-between gap-2 border-t bg-muted/40 px-4 py-3 sm:px-6">
        {/* Left: position indicator */}
        <div className="flex items-center gap-2">
          {position && (
            <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-[11px] font-semibold tabular-nums text-muted-foreground ring-1 ring-inset ring-border">
              {position}
            </span>
          )}
        </div>

        {/* Right: prev/next + close */}
        <div className="flex items-center gap-1.5">
          {(canPrev || canNext) && (
            <div className="mr-1 flex items-center gap-0.5 border-r border-border pr-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onPrev}
                disabled={!canPrev}
                aria-label="Previous officer"
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
                aria-label="Next officer"
                className="h-8 w-8 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
          >
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/** Generate a description based on the officer role. */
function getRoleDescription(role: string): string {
  const r = role.toLowerCase();
  if (r.includes("president")) {
    return "Leads the organization, sets the strategic vision, and represents the Alliance of Coders in university and partner engagements.";
  }
  if (r.includes("vice")) {
    return "Supports the President in overseeing operations, coordinates committee leads, and steps in to lead when needed.";
  }
  if (r.includes("secretary")) {
    return "Manages records, meeting minutes, and official correspondence to keep the organization running smoothly.";
  }
  if (r.includes("treasurer")) {
    return "Oversees financial planning, budget tracking, and fund allocation for events and initiatives.";
  }
  if (r.includes("pro") || r.includes("public")) {
    return "Handles promotions, social media presence, and public relations to amplify the organization's reach.";
  }
  if (r.includes("technical") || r.includes("tech")) {
    return "Leads the technical initiatives, oversees project development, and mentors members in coding best practices.";
  }
  if (r.includes("event")) {
    return "Plans and coordinates workshops, hackathons, and community events that bring members together.";
  }
  if (r.includes("audit")) {
    return "Reviews financial records and ensures transparency and accountability in all organizational transactions.";
  }
  return "A dedicated member of the Alliance of Coders leadership team, contributing to the organization's mission of building the future one commit at a time.";
}

/** Renders the Lucide icon matching an officer role. Each icon is referenced
 *  from a static module-level map so the react-hooks/static-components lint
 *  rule is satisfied (no component is created during render). */
function RoleIcon({ role }: { role: string }) {
  if (/president|vice/i.test(role)) return <Award className="h-3.5 w-3.5" aria-hidden="true" />;
  if (/secretary|audit/i.test(role)) return <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />;
  if (/treasurer/i.test(role)) return <Wallet className="h-3.5 w-3.5" aria-hidden="true" />;
  if (/pro|public|relations/i.test(role)) return <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />;
  if (/technical|tech/i.test(role)) return <Code2 className="h-3.5 w-3.5" aria-hidden="true" />;
  if (/event/i.test(role)) return <Calendar className="h-3.5 w-3.5" aria-hidden="true" />;
  return <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />;
}
