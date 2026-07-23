"use client";

import * as React from "react";
import {
  Copy,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import type { AdminYear, Officer } from "@/lib/types";

interface OfficersManagerProps {
  adminYears: AdminYear[];
  onRefresh: () => void;
}

// ---- Inline editable text field --------------------------------------------

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

  // Keep draft synced when the upstream value changes (e.g. after refresh).
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
    await onSave(next);
    setSaving(false);
    setEditing(false);
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

// ---- Officer row ------------------------------------------------------------

function OfficerRow({
  officer,
  onPatch,
  onDelete,
}: {
  officer: Officer;
  onPatch: (
    id: string,
    patch: Partial<Pick<Officer, "name" | "role" | "image">>
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    setDeleting(true);
    await onDelete(officer.id);
    setDeleting(false);
  }

  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-border/60 bg-card/40 p-3 transition-colors hover:bg-card/80 hover:border-gold-300/60 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
      {/* Avatar / image upload */}
      <div className="flex items-center justify-center">
        <OfficerImageBadge
          officer={officer}
          onImageChange={(image) => onPatch(officer.id, { image })}
        />
      </div>
      <InlineEditField
        value={officer.name}
        placeholder="Vacant Slot"
        maxLength={80}
        ariaLabel="officer name"
        onSave={async (name) => onPatch(officer.id, { name })}
      />
      <InlineEditField
        value={officer.role}
        placeholder="Open Position"
        maxLength={80}
        ariaLabel="officer role"
        className="text-muted-foreground"
        onSave={async (role) => onPatch(officer.id, { role })}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={handleDelete}
        disabled={deleting}
        aria-label={`Remove ${officer.name || "officer"}`}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * OfficerImageBadge - small circular avatar with upload-on-click.
 * Shows the officer photo or initials fallback; clicking opens file picker.
 */
function OfficerImageBadge({
  officer,
  onImageChange,
}: {
  officer: Officer;
  onImageChange: (image: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const initials = (officer.name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bucket", "officer");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.url) {
        onImageChange(data.url);
      }
    } catch {
      // Network error - silently fail, user can retry.
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      disabled={uploading}
      className="relative flex size-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-navy-700 to-navy-900 ring-1 ring-gold-400/30 transition hover:ring-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
      aria-label={`Upload photo for ${officer.name || "officer"}`}
      title="Upload photo"
    >
      {officer.image ? (
        <img
          src={officer.image}
          alt={officer.name || "Officer"}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="font-display text-xs font-bold text-gold-400">
          {initials || "?"}
        </span>
      )}
      {uploading && (
        <span className="absolute inset-0 flex items-center justify-center bg-navy-900/70">
          <Loader2 className="size-3.5 animate-spin text-white" />
        </span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFile}
      />
    </button>
  );
}

// ---- Year card --------------------------------------------------------------

function YearCard({
  year,
  onPatchYear,
  onAddOfficer,
  onPatchOfficer,
  onDeleteOfficer,
  onDuplicateYear,
  onDeleteYear,
}: {
  year: AdminYear;
  onPatchYear: (
    id: string,
    patch: Partial<Pick<AdminYear, "year" | "theme">>
  ) => Promise<void>;
  onAddOfficer: (yearId: string) => Promise<void>;
  onPatchOfficer: (
    id: string,
    patch: Partial<Pick<Officer, "name" | "role" | "image">>
  ) => Promise<void>;
  onDeleteOfficer: (id: string) => Promise<void>;
  onDuplicateYear: (year: AdminYear) => Promise<void>;
  onDeleteYear: (id: string) => Promise<void>;
}) {
  const [adding, _setAdding] = React.useState(false);
  const [duplicating, setDuplicating] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deletingYear, setDeletingYear] = React.useState(false);

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
              onClick={() => onAddOfficer(year.id)}
              disabled={adding}
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
              onClick={() => setConfirmDelete(true)}
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
                Click "Add Officer" above to create the first slot for this roster.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {year.officers.map((o) => (
              <OfficerRow
                key={o.id}
                officer={o}
                onPatch={onPatchOfficer}
                onDelete={onDeleteOfficer}
              />
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete year {year.year}?</DialogTitle>
            <DialogDescription>
              This will permanently remove the year and all{" "}
              {year.officers.length} officer
              {year.officers.length === 1 ? "" : "s"} listed under it. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deletingYear}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deletingYear}
              onClick={async () => {
                setDeletingYear(true);
                await onDeleteYear(year.id);
                setDeletingYear(false);
                setConfirmDelete(false);
              }}
            >
              {deletingYear ? "Deleting..." : "Delete year"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---- Add Year dialog --------------------------------------------------------

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
      { year, theme }
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
    patch: Partial<Pick<AdminYear, "year" | "theme">>
  ) {
    const { data, error } = await api.patch<{ item: AdminYear }>(
      `/api/admin-years/${id}`,
      patch
    );
    if (error || !data) {
      toast.error("Update failed", { description: error?.message });
      return;
    }
    onRefresh();
  }

  async function handleAddOfficer(yearId: string) {
    const { data, error } = await api.post<{ item: Officer }>(
      "/api/officers",
      { yearId }
    );
    if (error || !data) {
      toast.error("Could not add officer", { description: error?.message });
      return;
    }
    onRefresh();
    toast.success("Officer slot added", {
      description: "Click the name and role fields to fill in details.",
    });
  }

  async function handlePatchOfficer(
    id: string,
    patch: Partial<Pick<Officer, "name" | "role" | "image">>
  ) {
    const { data, error } = await api.patch<{ item: Officer }>(
      `/api/officers/${id}`,
      patch
    );
    if (error || !data) {
      toast.error("Could not save changes", { description: error?.message });
      onRefresh();
      return;
    }
    onRefresh();
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
      }
    );
    if (error || !data) {
      toast.error("Could not duplicate year", { description: error?.message });
      return;
    }
    // Duplicate officers into the new year.
    if (year.officers.length > 0) {
      await Promise.all(
        year.officers.map((o) =>
          api.post("/api/officers", {
            yearId: data.item.id,
            name: o.name,
            role: o.role,
            image: o.image,
          })
        )
      );
    }
    onRefresh();
    toast.success("Year duplicated", {
      description: `Created ${data.item.year} with ${year.officers.length} officer${year.officers.length === 1 ? "" : "s"}.`,
    });
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
              record. Click any field to edit it inline.
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
              onAddOfficer={handleAddOfficer}
              onPatchOfficer={handlePatchOfficer}
              onDeleteOfficer={handleDeleteOfficer}
              onDuplicateYear={handleDuplicateYear}
              onDeleteYear={handleDeleteYear}
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
