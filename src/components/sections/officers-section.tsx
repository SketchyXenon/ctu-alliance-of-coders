"use client";

import * as React from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Network,
  Search,
  Users,
  UserX,
  X,
} from "lucide-react";

import { SectionHeading } from "@/components/section-heading";
import { OfficerCard } from "@/components/officer-card";
import { OfficerOrgChart } from "@/components/officer-org-chart";
import { OfficerModal } from "@/components/officer-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AdminYear, Officer } from "@/lib/types";

type ViewMode = "grid" | "org";

interface OfficersSectionProps {
  adminYears: AdminYear[];
  /**
   * Reserved for future admin-panel usage. In the public view the cards are
   * rendered as non-editable (editable={false}).
   */
  onImageUpload?: (officerId: string, file: File) => void | Promise<void>;
}

const PAGE_SIZE = 8;

export function OfficersSection({
  adminYears,
}: OfficersSectionProps) {
  const sectionRef = React.useRef<HTMLElement | null>(null);

  // Sort years by sortOrder ascending so the last one is the "latest".
  const sortedYears = React.useMemo(
    () =>
      [...adminYears].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      ),
    [adminYears]
  );

  // Default to the latest year (last in sorted array).
  const [selectedYearIndex, setSelectedYearIndex] = React.useState<string>(
    () => {
      if (sortedYears.length === 0) return "";
      return String(sortedYears.length - 1);
    }
  );

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState("");
  const [viewMode, setViewMode] = React.useState<ViewMode>("grid");
  const [modalOfficer, setModalOfficer] = React.useState<Officer | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);

  const handleOfficerClick = React.useCallback((officer: Officer) => {
    setModalOfficer(officer);
    setModalOpen(true);
  }, []);

  // Keep selection valid if adminYears reference changes.
  React.useEffect(() => {
    if (sortedYears.length === 0) {
      if (selectedYearIndex !== "") setSelectedYearIndex("");
      return;
    }
    const idx = Number(selectedYearIndex);
    if (Number.isNaN(idx) || idx < 0 || idx >= sortedYears.length) {
      setSelectedYearIndex(String(sortedYears.length - 1));
    }
  }, [sortedYears, selectedYearIndex]);

  const selectedYear = React.useMemo<AdminYear | null>(() => {
    const idx = Number(selectedYearIndex);
    if (Number.isNaN(idx) || idx < 0 || idx >= sortedYears.length) return null;
    return sortedYears[idx] ?? null;
  }, [sortedYears, selectedYearIndex]);

  const officers = React.useMemo(() => {
    const sorted = (selectedYear?.officers ?? [])
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (o) =>
        (o.name ?? "").toLowerCase().includes(q) ||
        (o.role ?? "").toLowerCase().includes(q)
    );
  }, [selectedYear, search]);

  const totalPages = Math.max(1, Math.ceil(officers.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, officers.length);
  const visibleOfficers = officers.slice(pageStart, pageEnd);

  const handleYearChange = React.useCallback(
    (value: string) => {
      setSelectedYearIndex(value);
      setPage(1);
      setSearch("");
      // Smoothly scroll the section back into view so the new roster is visible.
      if (typeof window !== "undefined" && sectionRef.current) {
        window.requestAnimationFrame(() => {
          sectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });
      }
    },
    []
  );

  // Reset to page 1 whenever the search query changes.
  React.useEffect(() => {
    setPage(1);
  }, [search]);

  const goToPage = React.useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(1, next), totalPages);
      setPage(clamped);
    },
    [totalPages]
  );

  const goToPrev = React.useCallback(() => goToPage(safePage - 1), [
    goToPage,
    safePage,
  ]);
  const goToNext = React.useCallback(() => goToPage(safePage + 1), [
    goToPage,
    safePage,
  ]);

  // Keyboard navigation for pagination (left/right arrows when the pager is focused).
  const onPagerKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNext();
      } else if (event.key === "Home") {
        event.preventDefault();
        goToPage(1);
      } else if (event.key === "End") {
        event.preventDefault();
        goToPage(totalPages);
      }
    },
    [goToPrev, goToNext, goToPage, totalPages]
  );

  const showPagination = officers.length > PAGE_SIZE;
  const hasYears = sortedYears.length > 0;
  const hasOfficers = officers.length > 0;

  return (
    <section
      ref={sectionRef}
      id="officers"
      aria-labelledby="officers-heading"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:py-20"
    >
      <SectionHeading
        eyebrow="Organizational Chart"
        title="Officers & Leadership"
        sub="Meet the current leadership team."
        icon="Users"
        iconLabel="Officers"
      />

      {/* Year selector + search */}
      {hasYears && (
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="officers-year-select"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground font-display"
            >
              Academic Year
            </label>
            <Select value={selectedYearIndex} onValueChange={handleYearChange}>
              <SelectTrigger
                id="officers-year-select"
                aria-label="Select academic year"
                className={cn(
                  "w-[220px] bg-card font-display font-semibold text-foreground",
                  "hover:border-gold-400/60 focus-visible:border-gold-400 focus-visible:ring-gold-400/40"
                )}
              >
                <Calendar className="mr-1 h-4 w-4 text-gold-500" aria-hidden="true" />
                <SelectValue placeholder="Select a year" />
              </SelectTrigger>
              <SelectContent>
                {sortedYears.map((y, idx) => (
                  <SelectItem
                    key={y.id}
                    value={String(idx)}
                    className="font-display font-medium"
                  >
                    {y.year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search box - parity with Announcements section */}
          <div className="flex flex-col gap-1.5 sm:w-[260px]">
            <label
              htmlFor="officers-search"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground font-display"
            >
              Search
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="officers-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or role..."
                aria-label="Search officers by name or role"
                className={cn(
                  "h-10 bg-card pl-9 pr-9 text-sm",
                  "hover:border-gold-400/60 focus-visible:border-gold-400 focus-visible:ring-gold-400/40"
                )}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* No years at all */}
      {!hasYears && (
        <div className="mt-8 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserX className="h-6 w-6" aria-hidden="true" />
          </span>
          <h3 className="font-display text-lg font-semibold text-foreground">
            No officer records yet
          </h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Officer information for the Alliance of Coders has not been
            published. Please check back soon.
          </p>
        </div>
      )}

      {/* Year banner + grid */}
      {hasYears && selectedYear && (
        <>
          {/* View toggle - segmented control for Grid / Org Chart */}
          <div
            role="group"
            aria-label="Officers view mode"
            className="mt-6 flex items-center gap-1 rounded-lg border-2 border-border/60 bg-card p-1 w-fit shadow-sm"
          >
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              aria-pressed={viewMode === "grid"}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/50",
                viewMode === "grid"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              Grid
            </button>
            <button
              type="button"
              onClick={() => setViewMode("org")}
              aria-pressed={viewMode === "org"}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/50",
                viewMode === "org"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Network className="h-3.5 w-3.5" aria-hidden="true" />
              Org Chart
            </button>
          </div>

          {/* Year banner - signature element */}
          <div
            className={cn(
              "relative mt-6 overflow-hidden rounded-xl p-6 sm:p-8",
              "bg-gradient-to-r from-navy-700 to-navy-600 text-white shadow-lg",
              "ring-1 ring-inset ring-white/10"
            )}
          >
            {/* Decorative gold accents */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gold-400/10 blur-2xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-16 right-24 h-32 w-32 rounded-full bg-gold-500/10 blur-2xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-gold-400 via-gold-300 to-transparent"
            />

            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span
                  className={cn(
                    "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg",
                    "bg-white/10 ring-1 ring-inset ring-white/20",
                    "text-gold-300"
                  )}
                >
                  <Calendar className="h-6 w-6" aria-hidden="true" />
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-300/90 font-display">
                    Academic Year
                  </span>
                  <h3 className="font-display text-3xl font-bold leading-tight text-white sm:text-4xl">
                    {selectedYear.year}
                  </h3>
                  {selectedYear.theme && (
                    <p className="mt-1 max-w-xl text-sm italic text-white/80 sm:text-base">
                      &ldquo;{selectedYear.theme}&rdquo;
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 self-start sm:self-auto">
                <div
                  className={cn(
                    "flex flex-col items-end rounded-lg bg-white/5 px-4 py-2",
                    "ring-1 ring-inset ring-white/15"
                  )}
                >
                  <span className="font-display text-2xl font-bold text-gold-300 tabular-nums">
                    {officers.length}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
                    {officers.length === 1 ? "Officer" : "Officers"}
                  </span>
                </div>
                <Users className="h-8 w-8 text-white/30" aria-hidden="true" />
              </div>
            </div>
          </div>

          {/* Officers grid/tree or empty state - wrapped in a border-2 frame */}
          {hasOfficers ? (
            <div
              className={cn(
                "mt-8 rounded-xl border-2 border-border/60 bg-card/40 p-4 sm:p-6 shadow-sm"
              )}
            >
              {viewMode === "grid" ? (
                <>
                  <ul
                    role="list"
                    aria-label={`Officers for academic year ${selectedYear.year}`}
                    className={cn(
                      "grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4"
                    )}
                  >
                    {visibleOfficers.map((officer) => (
                      <li key={officer.id} className="flex">
                        <OfficerCard
                          officer={officer}
                          onClick={handleOfficerClick}
                        />
                      </li>
                    ))}
                  </ul>

                  {/* Pagination */}
                  {showPagination && (
                    <nav
                      aria-label="Officers pagination"
                      onKeyDown={onPagerKeyDown}
                      className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-between"
                    >
                      <p
                        className="text-xs text-muted-foreground tabular-nums"
                        aria-live="polite"
                      >
                        Showing{" "}
                        <span className="font-semibold text-foreground">
                          {pageStart + 1}
                        </span>
                        {"–"}
                        <span className="font-semibold text-foreground">
                          {pageEnd}
                        </span>{" "}
                        of{" "}
                        <span className="font-semibold text-foreground">
                          {officers.length}
                        </span>{" "}
                        officers
                      </p>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={goToPrev}
                          disabled={safePage <= 1}
                          aria-label="Previous page"
                          className={cn(
                            "h-8 px-2.5",
                            "hover:border-gold-400/60 hover:bg-gold-100/40 hover:text-gold-800",
                            "focus-visible:ring-2 focus-visible:ring-gold-400/50",
                            "dark:hover:bg-gold-400/10 dark:hover:text-gold-300"
                          )}
                        >
                          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                          <span className="sr-only sm:not-sr-only sm:ml-1">Prev</span>
                        </Button>

                        <div
                          role="group"
                          aria-label="Page numbers"
                          className="flex items-center gap-1"
                        >
                          {Array.from({ length: totalPages }).map((_, i) => {
                            const pageNum = i + 1;
                            const isActive = pageNum === safePage;
                            return (
                              <Button
                                key={pageNum}
                                type="button"
                                variant={isActive ? "default" : "outline"}
                                size="icon"
                                onClick={() => goToPage(pageNum)}
                                aria-label={`Page ${pageNum}`}
                                aria-current={isActive ? "page" : undefined}
                                className={cn(
                                  "h-8 w-8 text-xs tabular-nums",
                                  !isActive &&
                                    "hover:border-gold-400/60 hover:bg-gold-100/40 hover:text-gold-800 dark:hover:bg-gold-400/10 dark:hover:text-gold-300",
                                  isActive &&
                                    "bg-primary text-primary-foreground ring-1 ring-inset ring-gold-400/40"
                                )}
                              >
                                {pageNum}
                              </Button>
                            );
                          })}
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={goToNext}
                          disabled={safePage >= totalPages}
                          aria-label="Next page"
                          className={cn(
                            "h-8 px-2.5",
                            "hover:border-gold-400/60 hover:bg-gold-100/40 hover:text-gold-800",
                            "focus-visible:ring-2 focus-visible:ring-gold-400/50",
                            "dark:hover:bg-gold-400/10 dark:hover:text-gold-300"
                          )}
                        >
                          <span className="sr-only sm:not-sr-only sm:mr-1">Next</span>
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </nav>
                  )}
                </>
              ) : (
                <OfficerOrgChart
                  officers={officers}
                  onNodeClick={handleOfficerClick}
                />
              )}
            </div>
          ) : (
            <div
              className={cn(
                "mt-8 flex flex-col items-center justify-center gap-3",
                "rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center"
              )}
            >
              <span
                className={cn(
                  "inline-flex h-12 w-12 items-center justify-center rounded-full",
                  "bg-muted text-muted-foreground"
                )}
              >
                {search.trim() ? (
                  <Search className="h-6 w-6" aria-hidden="true" />
                ) : (
                  <UserX className="h-6 w-6" aria-hidden="true" />
                )}
              </span>
              <h3 className="font-display text-lg font-semibold text-foreground">
                {search.trim() ? "No matching officers" : "No officers for this year"}
              </h3>
              <p className="max-w-md text-sm text-muted-foreground">
                {search.trim() ? (
                  <>
                    No officers match{" "}
                    <span className="font-semibold text-foreground">
                      &ldquo;{search.trim()}&rdquo;
                    </span>
                    . Try a different name or role.
                  </>
                ) : (
                  <>
                    The roster for academic year{" "}
                    <span className="font-semibold text-foreground">
                      {selectedYear.year}
                    </span>{" "}
                    has not been published yet.
                  </>
                )}
              </p>
              {search.trim() && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSearch("")}
                  className="mt-2"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Clear search
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {/* Officer detail modal - passes the visible (filtered) list + year label
          so the modal supports prev/next navigation and shows the year served. */}
      <OfficerModal
        officer={modalOfficer}
        open={modalOpen}
        onOpenChange={setModalOpen}
        yearLabel={selectedYear?.year}
        list={officers.length > 1 ? officers : undefined}
        onNavigate={handleOfficerClick}
      />
    </section>
  );
}

export default OfficersSection;
