"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowDownUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Megaphone,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";

import type { Announcement, AnnouncementType, SyncStatus } from "@/lib/types";
import { ANNOUNCEMENT_TYPES, BADGE_CONFIG, FILTER_OPTIONS } from "@/lib/constants";
import { validateText } from "@/lib/security";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeading } from "@/components/section-heading";
import { AnnouncementCard } from "@/components/announcement-card";
import { AnnouncementModal } from "@/components/announcement-modal";
import { ImageUploadField } from "@/components/image-upload-field";

const PAGE_SIZE = 6;
const TITLE_MAX = 200;
const BODY_MAX = 1000;
const IMAGE_URL_MAX = 500;

type FilterValue = AnnouncementType | "all";

interface AnnouncementDraft {
  id?: string;
  title: string;
  type: AnnouncementType;
  body: string;
  image: string;
  pinned: boolean;
}

const EMPTY_DRAFT: AnnouncementDraft = {
  title: "",
  type: "general",
  body: "",
  image: "",
  pinned: false,
};

/** Generate a stable client-side id for optimistic UI. The server may
 *  reassign on persist. Uses crypto.randomUUID when available. */
function generateClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface AnnouncementsSectionProps {
  announcements: Announcement[];
  isAdmin: boolean;
  onAdd: (ann: Omit<Announcement, "date"> & { date?: string }) => void | Promise<void>;
  onUpdate: (ann: Announcement) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<boolean>;
  syncStatus: SyncStatus;
}

/**
 * AnnouncementsSection - the full news feed section.
 *
 * Composes the toolbar (filter + post button), the collapsible admin
 * post/edit form, a featured lead story, the responsive grid, pagination,
 * and the detail modal. Modal open state is owned locally.
 */
export function AnnouncementsSection({
  announcements,
  isAdmin,
  onAdd,
  onUpdate,
  onDelete,
  syncStatus,
}: AnnouncementsSectionProps) {
  const [filter, setFilter] = React.useState<FilterValue>("all");
  const [search, setSearch] = React.useState("");
  const [sortBy, setSortBy] = React.useState<"date-desc" | "date-asc" | "title-asc">("date-desc");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [showForm, setShowForm] = React.useState(false);
  const [draft, setDraft] = React.useState<AnnouncementDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [formSuccess, setFormSuccess] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [modalAnn, setModalAnn] = React.useState<Announcement | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);

  const isEditing = Boolean(draft.id);

  // Sort: pinned always first, then by selected sort option.
  const sorted = React.useMemo(() => {
    return [...announcements].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sortBy === "title-asc") {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === "date-asc") {
        return a.date.localeCompare(b.date);
      }
      return b.date.localeCompare(a.date);
    });
  }, [announcements, sortBy]);

  const filtered = React.useMemo(() => {
    let result = sorted;
    if (filter !== "all") {
      result = result.filter((a) => a.type === filter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.body.toLowerCase().includes(q)
      );
    }
    if (dateFrom) {
      result = result.filter((a) => a.date >= dateFrom);
    }
    if (dateTo) {
      result = result.filter((a) => a.date <= dateTo);
    }
    return result;
  }, [sorted, filter, search, dateFrom, dateTo]);

  const hasDateFilter = Boolean(dateFrom || dateTo);

  function clearDateFilter() {
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  // Featured lead = first pinned (or first overall), rest go to the grid.
  const featured = filtered[0] ?? null;
  const rest = filtered.slice(1);

  const totalPages = Math.max(1, Math.ceil(rest.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, rest.length);
  const pagedRest = rest.slice(pageStart, pageEnd);

  // Keep page in bounds when the list shrinks (filter change, delete).
  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const openModal = React.useCallback((ann: Announcement) => {
    setModalAnn(ann);
    setModalOpen(true);
  }, []);

  // Navigate to a different announcement within the modal (prev/next).
  const handleModalNavigate = React.useCallback((ann: Announcement) => {
    setModalAnn(ann);
  }, []);

  // Wrap onDelete so the card/modal receive a Promise<void> (parent returns
  // Promise<boolean> for success signalling, which we discard here).
  const handleCardDelete = React.useCallback(
    async (id: string) => {
      await onDelete(id);
    },
    [onDelete]
  );

  const startCreate = () => {
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setFormSuccess(null);
    setShowForm(true);
  };

  const startEdit = React.useCallback((ann: Announcement) => {
    setDraft({
      id: ann.id,
      title: ann.title,
      type: ann.type,
      body: ann.body,
      image: ann.image ?? "",
      pinned: ann.pinned,
    });
    setFormError(null);
    setFormSuccess(null);
    setShowForm(true);
  }, []);

  const cancelForm = () => {
    setShowForm(false);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setFormSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const titleCheck = validateText(draft.title, {
      required: true,
      maxLen: TITLE_MAX,
      minLen: 3,
    });
    if (!titleCheck.valid) {
      setFormError(titleCheck.error);
      return;
    }
    const bodyCheck = validateText(draft.body, {
      required: true,
      maxLen: BODY_MAX,
      minLen: 4,
    });
    if (!bodyCheck.valid) {
      setFormError(bodyCheck.error);
      return;
    }
    if (draft.image) {
      const imgCheck = validateText(draft.image, { maxLen: IMAGE_URL_MAX });
      if (!imgCheck.valid) {
        setFormError(imgCheck.error);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isEditing && draft.id) {
        const existing = announcements.find((a) => a.id === draft.id);
        await onUpdate({
          id: draft.id,
          title: draft.title.trim(),
          type: draft.type,
          body: draft.body.trim(),
          image: draft.image.trim() || null,
          pinned: draft.pinned,
          date:
            existing?.date ??
            new Date().toISOString().slice(0, 10),
        });
        setFormSuccess("Announcement updated successfully.");
      } else {
        await onAdd({
          id: generateClientId(),
          title: draft.title.trim(),
          type: draft.type,
          body: draft.body.trim(),
          image: draft.image.trim() || null,
          pinned: draft.pinned,
        });
        setFormSuccess("Announcement published successfully.");
      }
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to save announcement."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      id="announcements"
      aria-labelledby="announcements-heading"
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20"
    >
      <SectionHeading
        eyebrow="Latest News"
        title="Announcements"
        sub="Awards, recognitions, and reports."
        icon="Megaphone"
        iconLabel="Announcements"
      />

      {/* Toolbar */}
      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Label
              htmlFor="announcement-filter"
              className="text-xs uppercase tracking-[0.18em] text-muted-foreground"
            >
              Filter by type
            </Label>
            <Select
              value={filter}
              onValueChange={(v) => {
                setFilter(v as FilterValue);
                setPage(1);
              }}
            >
              <SelectTrigger
                id="announcement-filter"
                className="w-[180px]"
                aria-label="Filter announcements by type"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="announcement-search"
              className="text-xs uppercase tracking-[0.18em] text-muted-foreground"
            >
              Search
            </Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="announcement-search"
                type="search"
                placeholder="Search title or body..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 sm:w-[220px]"
                aria-label="Search announcements"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="announcement-sort"
              className="text-xs uppercase tracking-[0.18em] text-muted-foreground"
            >
              Sort by
            </Label>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger
                id="announcement-sort"
                className="w-full sm:w-[160px]"
                aria-label="Sort announcements"
              >
                <ArrowDownUp className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date-desc">Newest first</SelectItem>
                <SelectItem value="date-asc">Oldest first</SelectItem>
                <SelectItem value="title-asc">Title A-Z</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? "post" : "posts"}
          </span>
        </div>

        {isAdmin && (
          <Button
            type="button"
            onClick={startCreate}
            className="transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
          >
            <Plus className="h-4 w-4" />
            Post Announcement
          </Button>
        )}
      </div>

      {/* Visual filter chips */}
      <div className="mt-4 flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => {
          const isActive = filter === opt.value;
          const count =
            opt.value === "all"
              ? announcements.length
              : announcements.filter((a) => a.type === opt.value).length;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setFilter(opt.value);
                setPage(1);
              }}
              aria-pressed={isActive}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                isActive
                  ? "border-gold-400 bg-gold-500/15 text-gold-700 dark:text-gold-300"
                  : "border-border bg-card text-muted-foreground hover:border-gold-300/50 hover:text-foreground"
              )}
            >
              {opt.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                  isActive
                    ? "bg-gold-500/20 text-gold-800 dark:text-gold-200"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Date range filter */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ann-date-from" className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            From
          </Label>
          <Input
            id="ann-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Filter announcements from date"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ann-date-to" className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            To
          </Label>
          <Input
            id="ann-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Filter announcements to date"
          />
        </div>
        {hasDateFilter && (
          <Button variant="ghost" size="sm" onClick={clearDateFilter} className="h-9">
            <X className="mr-1 h-3.5 w-3.5" />
            Clear dates
          </Button>
        )}
      </div>

      {/* Sync error */}
      {isAdmin && syncStatus.error && (
        <Alert variant="destructive" className="mt-6" role="alert">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Sync error</AlertTitle>
          <AlertDescription>{syncStatus.error}</AlertDescription>
        </Alert>
      )}

      {/* Admin post/edit form */}
      {isAdmin && showForm && (
        <Card className="mt-6 border-gold-300 shadow-md ring-1 ring-gold-300/40">
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
            <div>
              <CardTitle className="font-display text-xl">
                {isEditing ? "Edit Announcement" : "New Announcement"}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {isEditing
                  ? "Update the details below and save your changes."
                  : "Fill in the details below to publish a new announcement."}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close form"
              onClick={cancelForm}
              className="h-8 w-8 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="ann-title">
                  Title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ann-title"
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                  maxLength={TITLE_MAX}
                  placeholder="Enter a clear, descriptive title"
                  required
                  aria-required="true"
                  aria-describedby="ann-title-help"
                />
                <p id="ann-title-help" className="text-xs text-muted-foreground">
                  {draft.title.length}/{TITLE_MAX} characters
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ann-type">Type</Label>
                <Select
                  value={draft.type}
                  onValueChange={(v) =>
                    setDraft({ ...draft, type: v as AnnouncementType })
                  }
                >
                  <SelectTrigger
                    id="ann-type"
                    className="w-full"
                    aria-label="Announcement type"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANNOUNCEMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {BADGE_CONFIG[t].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ann-body">
                  Body <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="ann-body"
                  value={draft.body}
                  onChange={(e) =>
                    setDraft({ ...draft, body: e.target.value })
                  }
                  maxLength={BODY_MAX}
                  rows={6}
                  placeholder="Write the announcement details. Separate paragraphs with a blank line."
                  required
                  aria-required="true"
                  aria-describedby="ann-body-help"
                />
                <p id="ann-body-help" className="text-xs text-muted-foreground">
                  {draft.body.length}/{BODY_MAX} characters
                </p>
              </div>

              <ImageUploadField
                id="ann-image"
                label="Cover image"
                value={draft.image}
                onChange={(url) => setDraft({ ...draft, image: url })}
                bucket="announcement"
              />

              <div className="flex items-center gap-2">
                <Checkbox
                  id="ann-pinned"
                  checked={draft.pinned}
                  onCheckedChange={(v) =>
                    setDraft({ ...draft, pinned: v === true })
                  }
                />
                <Label htmlFor="ann-pinned" className="cursor-pointer">
                  Pin to top
                </Label>
              </div>

              {formError && (
                <Alert variant="destructive" role="alert">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  <AlertTitle>Could not save</AlertTitle>
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
              {formSuccess && (
                <Alert role="status">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <AlertTitle>Saved</AlertTitle>
                  <AlertDescription>{formSuccess}</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelForm}
                  disabled={submitting}
                  className="transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
                >
                  <Send className="h-4 w-4" />
                  {submitting
                    ? "Saving..."
                    : isEditing
                      ? "Save Changes"
                      : "Publish"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Featured lead story */}
      {featured && (
        <div className="mt-10">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gold-100 text-gold-700 dark:bg-gold-500/15 dark:text-gold-300">
              <Megaphone className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Featured story
            </span>
          </div>
          <AnnouncementCard
            ann={featured}
            isAdmin={isAdmin}
            onDelete={handleCardDelete}
            onEdit={startEdit}
            featured
            onOpen={openModal}
          />
        </div>
      )}

      {/* Grid */}
      {pagedRest.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {pagedRest.map((ann) => (
            <AnnouncementCard
              key={ann.id}
              ann={ann}
              isAdmin={isAdmin}
              onDelete={handleCardDelete}
              onEdit={startEdit}
              onOpen={openModal}
            />
          ))}
        </div>
      ) : (
        !featured && <EmptyState filter={filter} />
      )}

      {/* Pagination */}
      {rest.length > PAGE_SIZE && (
        <nav
          className="mt-10 flex flex-col items-center justify-between gap-4 border-t pt-6 sm:flex-row"
          aria-label="Announcements pagination"
        >
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Showing {pageStart + 1}–{pageEnd} of {rest.length}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
              className="transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-40 disabled:active:scale-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Button
                key={p}
                type="button"
                variant={p === currentPage ? "default" : "outline"}
                size="icon"
                onClick={() => setPage(p)}
                aria-label={`Page ${p}`}
                aria-current={p === currentPage ? "page" : undefined}
                className="transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
              >
                {p}
              </Button>
            ))}
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
              className="transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-40 disabled:active:scale-100"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </nav>
      )}

      {/* Detail modal */}
      <AnnouncementModal
        ann={modalAnn}
        open={modalOpen}
        onOpenChange={setModalOpen}
        isAdmin={isAdmin}
        onDelete={handleCardDelete}
        onEdit={startEdit}
        list={filtered}
        onNavigate={handleModalNavigate}
      />
    </section>
  );
}

function EmptyState({ filter }: { filter: FilterValue }) {
  return (
    <div className="mt-12 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/30 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Inbox className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="font-display text-lg font-semibold text-foreground">
        No announcements found
      </h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        {filter === "all"
          ? "There are no announcements yet. Check back soon for updates."
          : `No ${filter} announcements right now. Try a different filter.`}
      </p>
    </div>
  );
}
