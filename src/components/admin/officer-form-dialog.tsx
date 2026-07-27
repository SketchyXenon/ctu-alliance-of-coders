"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUploadField } from "@/components/image-upload-field";
import type { Officer } from "@/lib/types";

const NAME_MAX = 80;
const ROLE_MAX = 80;

export interface OfficerFormDraft {
  name: string;
  role: string;
  image: string;
  /** null = root (reports to no one in this year). */
  reportsToId: string | null;
}

export interface OfficerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = add mode; an officer = edit mode. */
  officer: Officer | null;
  /** The year label, shown in the dialog title for context. */
  yearLabel?: string;
  /** All officers in the same year, for the reports-to picker. In edit mode
   *  the officer being edited is excluded (can't report to self). */
  peers: Officer[];
  onSubmit: (draft: OfficerFormDraft) => Promise<void>;
}

/**
 * OfficerFormDialog - modal for adding OR editing an officer in one shot.
 *
 * Replaces the previous inline-edit-per-field UX so the admin can fill in
 * name + role + image + reports-to together (per the feature request:
 * "modify the adding of officers as modal so that we can edit all the info
 * all at once"). The same dialog serves both create and edit: pass
 * `officer={null}` for add, or the officer for edit.
 *
 * Per 05-ui-ux-design.md section 6: edit/add actions use a SOFT confirm
 * (single-step "Save"/"Add" button), unlike destructive deletes. The dialog
 * disables the submit button while a submission is in flight so a slow
 * network can't be double-clicked into duplicate creates.
 */
export function OfficerFormDialog({
  open,
  onOpenChange,
  officer,
  yearLabel,
  peers,
  onSubmit,
}: OfficerFormDialogProps) {
  const isEdit = officer !== null;
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [image, setImage] = React.useState("");
  const [reportsToId, setReportsToId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset the form whenever the dialog opens. Populate from the officer in
  // edit mode, or start blank in add mode. Per 05 section 4: full state set —
  // the dialog always opens in a known state, never stale from a prior open.
  React.useEffect(() => {
    if (!open) return;
    if (officer) {
      setName(officer.name === "Vacant Slot" ? "" : officer.name);
      setRole(officer.role === "Open Position" ? "" : officer.role);
      setImage(officer.image ?? "");
      setReportsToId(officer.reportsToId ?? null);
    } else {
      setName("");
      setRole("");
      setImage("");
      setReportsToId(null);
    }
  }, [open, officer]);

  // Peers available as parents: exclude the officer being edited (can't report
  // to self). In add mode, all peers are eligible. The reportsTo picker shows
  // name + role so the admin can distinguish same-named officers.
  const eligiblePeers = React.useMemo(() => {
    return officer ? peers.filter((p) => p.id !== officer.id) : peers;
  }, [peers, officer]);

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        role: role.trim(),
        image: image.trim(),
        reportsToId,
      });
      onOpenChange(false);
    } catch (e) {
      // Surface the error inline so the admin can fix + retry without losing
      // their typed values. Per 05 section 6: state what happened + next step.
      const msg = e instanceof Error ? e.message : "Could not save officer.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const title = isEdit
    ? `Edit officer${yearLabel ? ` — ${yearLabel}` : ""}`
    : `Add officer${yearLabel ? ` — ${yearLabel}` : ""}`;
  const description = isEdit
    ? "Update any field. The reports-to picker sets the org-chart parent."
    : "Fill in the details. Leave name empty to create a vacant slot.";

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="officer-name">Name</Label>
            <Input
              id="officer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name (leave empty for a vacant slot)"
              maxLength={NAME_MAX}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {name.length}/{NAME_MAX}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="officer-role">Role / Position</Label>
            <Input
              id="officer-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. President, Secretary, Auditor"
              maxLength={ROLE_MAX}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {role.length}/{ROLE_MAX}
            </p>
          </div>

          <ImageUploadField
            id="officer-image"
            label="Photo"
            value={image}
            onChange={setImage}
            bucket="officer"
          />

          <div className="space-y-2">
            <Label htmlFor="officer-reports-to">Reports to (org-chart parent)</Label>
            <Select
              value={reportsToId ?? "__root__"}
              onValueChange={(v) => setReportsToId(v === "__root__" ? null : v)}
            >
              <SelectTrigger id="officer-reports-to" className="w-full">
                <SelectValue placeholder="Select a parent officer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">— Root (no parent) —</SelectItem>
                {eligiblePeers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name || "Vacant Slot"} — {p.role || "Open Position"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Sets where this officer sits in the org chart. Root officers appear
              at the top.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />}
            {submitting
              ? "Saving..."
              : isEdit
                ? "Save changes"
                : "Add officer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
