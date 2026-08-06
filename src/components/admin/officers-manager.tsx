"use client";

import * as React from "react";
import {
  Copy,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  List,
  Network,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OfficerOrgChart } from "@/components/officer-org-chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  OfficerFormDialog,
  type OfficerFormDraft,
} from "@/components/admin/officer-form-dialog";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AdminYear, Officer } from "@/lib/types";

interface OfficersManagerProps {
  adminYears: AdminYear[];
  onRefresh: () => void;
}

function InlineEditField({
  value,
  onSave,
  placeholder,
  maxLength,
  className,
  ariaLabel,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
  placeholder?: string;
  maxLength: number;
  className?: string;
  ariaLabel: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  async function commit() {
    const next = draft.trim();
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);

      setEditing(false);
    } catch {
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        disabled={saving}
        className={className}
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`group inline-flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/60 focus:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${className ?? ""}`}
      aria-label={`Edit ${ariaLabel}`}
    >
      <span className="flex-1 truncate">{value || placeholder}</span>
      <Pencil
        className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </button>
  );
}

function OfficerRow({
  officer,
  onEdit,
  onDelete,
}: {
  officer: Officer;
  onEdit: (officer: Officer) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = React.useState(false);

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const confirmToken = officer.name?.trim()
    ? officer.name.trim().slice(0, 40)
    : "DELETE";

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await onDelete(officer.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-border/60 bg-card/40 p-3 transition-colors hover:bg-card/80 hover:border-gold-300/60 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
      <div className="flex items-center justify-center">
        <OfficerImageBadge officer={officer} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {officer.name || "Vacant Slot"}
        </p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm text-muted-foreground">
          {officer.role || "Open Position"}
        </p>
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => onEdit(officer)}
          aria-label={`Edit ${officer.name || "officer"}`}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          aria-label={`Remove ${officer.name || "officer"}`}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        mode="destructive"
        title={`Remove ${officer.name || "this officer"}?`}
        description={`This permanently removes ${officer.name || "this vacant slot"}${officer.role ? ` (${officer.role})` : ""} from the roster. This action cannot be undone.`}
        confirmLabel={deleting ? "Removing..." : "Remove officer"}
        confirmToken={confirmToken}
        confirmTokenHint="the officer's name"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function OfficerImageBadge({ officer }: { officer: Officer }) {
  const initials = (officer.name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  return (
    <span
      className="relative flex size-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-navy-700 to-navy-900 ring-1 ring-gold-400/30"
      aria-hidden="true"
    >
      {officer.image ? (
        <img
          src={officer.image}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="font-display text-xs font-bold text-gold-400">
          {initials || "?"}
        </span>
      )}
    </span>
  );
}

function YearCard({
  year,
  onPatchYear,
  onSubmitOfficer,
  onDeleteOfficer,
  onDuplicateYear,
  onDeleteYear,
  onRefresh,
}: {
  year: AdminYear;
  onPatchYear: (
    id: string,
    patch: Partial<Pick<AdminYear, "year" | "theme">>,
  ) => Promise<void>;

  onSubmitOfficer: (
    yearId: string,
    officer: Officer | null,
    draft: OfficerFormDraft,
  ) => Promise<void>;
  onDeleteOfficer: (id: string) => Promise<void>;
  onDuplicateYear: (year: AdminYear) => Promise<void>;

  onRefresh: () => void;
  onDeleteYear: (id: string) => Promise<void>;
}) {
  const [formState, setFormState] = React.useState<{
    officer: Officer | null;
  } | null>(null);
  const [duplicating, setDuplicating] = React.useState(false);
  const [deletingYear, setDeletingYear] = React.useState(false);
  const [confirmYearDelete, setConfirmYearDelete] = React.useState(false);

  const [yearView, setYearView] = React.useState<"list" | "chart">("list");

  const dialogOpen = formState !== null;

  async function handleSubmitOfficer(draft: OfficerFormDraft) {
    await onSubmitOfficer(year.id, formState?.officer ?? null, draft);
  }

  return (
    <Card className="border-2 border-border/60 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="border-b pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 font-display text-xl">
              <InlineEditField
                value={year.year}
                placeholder="Year label"
                maxLength={30}
                ariaLabel="year label"
                onSave={async (y) => onPatchYear(year.id, { year: y })}
              />
            </CardTitle>
            <CardDescription className="text-sm">
              <InlineEditField
                value={year.theme}
                placeholder="Add a leadership theme"
                maxLength={200}
                ariaLabel="year theme"
                onSave={async (theme) => onPatchYear(year.id, { theme })}
              />
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Users className="size-3" aria-hidden="true" />
              {year.officers.length} officers
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFormState({ officer: null })}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add Officer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                setDuplicating(true);
                await onDuplicateYear(year);
                setDuplicating(false);
              }}
              disabled={duplicating}
              aria-label={`Duplicate ${year.year}`}
            >
              <Copy className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Duplicate</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmYearDelete(true)}
              aria-label={`Delete ${year.year}`}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {year.officers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-navy-700 to-navy-900 text-gold-400 shadow-sm">
              <Users className="size-6" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="font-display text-sm font-semibold text-foreground">
                No officers in this year yet
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Click &ldquo;Add Officer&rdquo; above to create the first slot
                for this roster.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div
              role="group"
              aria-label={`Officer view mode for ${year.year}`}
              className="mb-3 flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-1 w-fit"
            >
              <button
                type="button"
                onClick={() => setYearView("list")}
                aria-pressed={yearView === "list"}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/50",
                  yearView === "list"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <List className="h-3.5 w-3.5" aria-hidden="true" />
                List
              </button>
              <button
                type="button"
                onClick={() => setYearView("chart")}
                aria-pressed={yearView === "chart"}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/50",
                  yearView === "chart"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Network className="h-3.5 w-3.5" aria-hidden="true" />
                Org Chart
              </button>
            </div>

            {yearView === "list" ? (
              <div className="space-y-2">
                {year.officers.map((o) => (
                  <OfficerRow
                    key={o.id}
                    officer={o}
                    onEdit={(officer) => setFormState({ officer })}
                    onDelete={onDeleteOfficer}
                  />
                ))}
              </div>
            ) : (
              <OfficerOrgChart
                officers={year.officers}
                showVacant
                editable
                onConnect={async (parentId, childId) => {
                  try {
                    const { error } = await api.patch(
                      `/api/officers/${childId}`,
                      {
                        reportsToId: parentId,
                      },
                    );
                    if (error) {
                      toast.error("Could not set reporting line", {
                        description: error.message,
                      });
                      return;
                    }
                    toast.success("Reporting line set", {
                      description: "The org chart has been updated.",
                    });
                    onRefresh();
                  } catch (e) {
                    toast.error("Could not set reporting line", {
                      description:
                        e instanceof Error ? e.message : "Unknown error",
                    });
                  }
                }}
                onEdgeDelete={async (childId) => {
                  try {
                    const { error } = await api.patch(
                      `/api/officers/${childId}`,
                      {
                        reportsToId: null,
                      },
                    );
                    if (error) {
                      toast.error("Could not remove reporting line", {
                        description: error.message,
                      });
                      return;
                    }
                    toast.success("Reporting line removed", {
                      description: "The officer is now a root.",
                    });
                    onRefresh();
                  } catch (e) {
                    toast.error("Could not remove reporting line", {
                      description:
                        e instanceof Error ? e.message : "Unknown error",
                    });
                  }
                }}
              />
            )}
          </>
        )}
      </CardContent>

      <OfficerFormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && setFormState(null)}
        officer={formState?.officer ?? null}
        yearLabel={year.year}
        peers={year.officers}
        onSubmit={handleSubmitOfficer}
      />

      <ConfirmDialog
        open={confirmYearDelete}
        onOpenChange={setConfirmYearDelete}
        mode="destructive"
        title={`Delete year ${year.year}?`}
        description={`This will permanently remove the year and all ${year.officers.length} officer${year.officers.length === 1 ? "" : "s"} listed under it. This action cannot be undone.`}
        confirmLabel={deletingYear ? "Deleting..." : "Delete year"}
        confirmToken={year.year}
        confirmTokenHint="the year label"
        onConfirm={async () => {
          setDeletingYear(true);
          try {
            await onDeleteYear(year.id);
          } finally {
            setDeletingYear(false);
          }
        }}
      />
    </Card>
  );
}

function AddYearDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (year: string, theme: string) => Promise<void>;
}) {
  const [year, setYear] = React.useState("");
  const [theme, setTheme] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  // Reset fields each time the dialog opens.
  React.useEffect(() => {
    if (open) {
      setYear("");
      setTheme("");
    }
  }, [open]);

  async function handleCreate() {
    if (!year.trim()) {
      toast.error("Year label is required.");
      return;
    }
    setCreating(true);
    await onCreate(year.trim(), theme.trim());
    setCreating(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add leadership year</DialogTitle>
          <DialogDescription>
            Create a new year container to organize officers. You can fill in
            the theme now or edit it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-year-label">Year label</Label>
            <Input
              id="new-year-label"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2025-2026"
              maxLength={30}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-year-theme">Theme (optional)</Label>
            <Input
              id="new-year-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="e.g. Building the future, one commit at a time"
              maxLength={200}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create year"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main component ---------------------------------------------------------

export function OfficersManager({
  adminYears,
  onRefresh,
}: OfficersManagerProps) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  async function handleCreateYear(year: string, theme: string) {
    setCreating(true);
    const { data, error } = await api.post<{ item: AdminYear }>(
      "/api/admin-years",
      { year, theme },
    );
    setCreating(false);
    if (error || !data) {
      toast.error("Could not create year", {
        description: error?.message ?? "Please try again.",
      });
      return;
    }
    onRefresh();
    toast.success("Year created", {
      description: `${data.item.year} is ready. Add officers below.`,
    });
  }

  async function handlePatchYear(
    id: string,
    patch: Partial<Pick<AdminYear, "year" | "theme">>,
  ) {
    const { data, error } = await api.patch<{ item: AdminYear }>(
      `/api/admin-years/${id}`,
      patch,
    );
    if (error || !data) {
      toast.error("Update failed", { description: error?.message });
      // Throw so InlineEditField keeps the editor open (FIX-3).
      throw new Error(error?.message ?? "Update failed");
    }
    onRefresh();
  }

  async function handleSubmitOfficer(
    yearId: string,
    officer: Officer | null,
    draft: OfficerFormDraft,
  ) {
    if (officer) {
      const { data, error } = await api.patch<{ item: Officer }>(
        `/api/officers/${officer.id}`,
        {
          name: draft.name,
          role: draft.role,
          image: draft.image,
          reportsToId: draft.reportsToId,
        },
      );
      if (error || !data) {
        throw new Error(error?.message ?? "Could not save changes.");
      }
      onRefresh();
      toast.success("Officer updated", {
        description: `${data.item.name || "Vacant slot"} (${data.item.role || "open position"}) saved.`,
      });
    } else {
      const { data, error } = await api.post<{ item: Officer }>(
        "/api/officers",
        {
          yearId,
          name: draft.name,
          role: draft.role,
          image: draft.image,
          reportsToId: draft.reportsToId,
        },
      );
      if (error || !data) {
        throw new Error(error?.message ?? "Could not add officer.");
      }
      onRefresh();
      toast.success("Officer added", {
        description: `${data.item.name || "Vacant slot"} (${data.item.role || "open position"}) added to the roster.`,
      });
    }
  }

  async function handleDeleteOfficer(id: string) {
    const { error } = await api.delete(`/api/officers/${id}`);
    if (error) {
      toast.error("Could not delete officer", { description: error.message });
      return;
    }
    onRefresh();
    toast.success("Officer removed");
  }

  async function handleDuplicateYear(year: AdminYear) {
    const { data, error } = await api.post<{ item: AdminYear }>(
      "/api/admin-years",
      {
        year: `${year.year} (copy)`,
        theme: year.theme,
      },
    );
    if (error || !data) {
      toast.error("Could not duplicate year", { description: error?.message });
      return;
    }

    let successCount = 0;
    let failCount = 0;
    if (year.officers.length > 0) {
      const results = await Promise.allSettled(
        year.officers.map((o) =>
          api.post("/api/officers", {
            yearId: data.item.id,
            name: o.name,
            role: o.role,
            image: o.image,
          }),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled" && !r.value.error) {
          successCount++;
        } else {
          failCount++;
        }
      }
    }
    onRefresh();
    if (failCount === 0) {
      toast.success("Year duplicated", {
        description: `Created ${data.item.year} with ${successCount} officer${successCount === 1 ? "" : "s"}.`,
      });
    } else {
      toast.warning("Year duplicated (partial)", {
        description: `Created ${data.item.year}. ${successCount} officer${successCount === 1 ? "" : "s"} copied, ${failCount} failed. Please check the new year and add missing officers manually.`,
      });
    }
  }

  async function handleDeleteYear(id: string) {
    const { error } = await api.delete(`/api/admin-years/${id}`);
    if (error) {
      toast.error("Could not delete year", { description: error.message });
      return;
    }
    onRefresh();
    toast.success("Year deleted");
  }

  async function handleRefresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  return (
    <div className="space-y-5">
      <Card className="border-border/60 bg-muted/30">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-display text-lg font-semibold">
              Leadership Years
            </p>
            <p className="text-sm text-muted-foreground">
              {adminYears.length} year{adminYears.length === 1 ? "" : "s"} on
              record. Click &ldquo;Add Officer&rdquo; to create a slot, or the
              pencil to edit one.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh years"
            >
              <RefreshCw
                className={refreshing ? "size-4 animate-spin" : "size-4"}
                aria-hidden="true"
              />
            </Button>
            <Button onClick={() => setAddOpen(true)} disabled={creating}>
              <Plus className="size-4" aria-hidden="true" />
              Add Year
            </Button>
          </div>
        </CardContent>
      </Card>

      {adminYears.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Users className="size-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                No leadership years yet.
              </p>
              <p className="text-xs text-muted-foreground">
                Add your first year to start organizing officers.
              </p>
            </div>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Add Year
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {adminYears.map((y) => (
            <YearCard
              key={y.id}
              year={y}
              onPatchYear={handlePatchYear}
              onSubmitOfficer={handleSubmitOfficer}
              onDeleteOfficer={handleDeleteOfficer}
              onDuplicateYear={handleDuplicateYear}
              onDeleteYear={handleDeleteYear}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}

      <AddYearDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreate={handleCreateYear}
      />
    </div>
  );
}
