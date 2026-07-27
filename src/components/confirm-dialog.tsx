"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * ConfirmDialog - reusable confirmation modal with two modes.
 *
 * Per 05-ui-ux-design.md section 6:
 *   - Destructive action (delete, irreversible change) -> Modal with explicit
 *     confirm. "Strict double confirmation" here means a TWO-STEP flow:
 *     step 1 shows the consequence, step 2 requires typing a confirmation
 *     token (default "DELETE") so the action cannot happen from a single
 *     mis-click or a stray Enter.
 *   - Edit / add actions use `mode="soft"`: a single-step confirm dialog
 *     ("Save changes?" -> Confirm/Cancel). Lighter than destructive but still
 *     guards against accidental submits.
 *
 * The dialog is controlled (`open` + `onOpenChange`) so the parent owns the
 * promise lifecycle. `onConfirm` is async-aware: while it is pending the
 * buttons disable and a spinner shows, so a slow network cannot be
 * double-clicked.
 */

export type ConfirmMode = "destructive" | "soft";

/**
 * Pure derivation of whether the confirm button should be armed.
 * Extracted so it can be unit-tested without rendering the component
 * (the project's test suite favors pure-function unit tests per
 * 04-testing-methodology.md section 2). Per 06 A10: fail closed — when in
 * doubt (token mismatch / pending), the destructive action stays disabled.
 */
export function canConfirmAction(opts: {
  mode: ConfirmMode;
  typed: string;
  confirmToken: string;
  pending: boolean;
}): boolean {
  const { mode, typed, confirmToken, pending } = opts;
  if (pending) return false;
  // Soft mode: no token gate; one-step confirm.
  if (mode !== "destructive") return true;
  // Destructive mode: token must match exactly (trimmed) before arming.
  return typed.trim() === confirmToken;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  mode?: ConfirmMode;
  /**
   * For destructive mode: the token the user must type to enable the confirm
   * button. Defaults to "DELETE". Ignored in soft mode.
   */
  confirmToken?: string;
  /** Hint shown next to the token input, e.g. "the officer's name". */
  confirmTokenHint?: string;
  onConfirm: () => void | Promise<void>;
  /** Optional extra context rendered above the footer (e.g. a record preview). */
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  mode = "soft",
  confirmToken = "DELETE",
  confirmTokenHint,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const isDestructive = mode === "destructive";
  const [typed, setTyped] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset internal state whenever the dialog opens/closes so reopens start
  // fresh (no stale typed token, no stale error from a previous attempt).
  React.useEffect(() => {
    if (!open) {
      setTyped("");
      setPending(false);
      setError(null);
    }
  }, [open]);

  // In destructive mode the confirm button is only armed when the typed token
  // matches. In soft mode it is always armed. Per 06 A10: fail closed — when
  // in doubt, disable the destructive action.
  const tokenMatches = canConfirmAction({
    mode,
    typed,
    confirmToken,
    pending,
  });
  const canConfirm = tokenMatches;

  async function handleConfirm() {
    if (!canConfirm) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      // Let the parent close via onOpenChange(false) in its handler; if it
      // hasn't, close ourselves so the dialog never sticks open on success.
      onOpenChange(false);
    } catch (e) {
      // Surface the error inline (per 05 section 6: state what happened + next
      // step). Keep the dialog open so the user can retry without re-opening.
      setError(e instanceof Error ? e.message : "Action failed. Please try again.");
      setPending(false);
    }
  }

  function handleOpenChange(next: boolean) {
    // Block close-during-pending so a network race can't leave a half-applied
    // state with the dialog dismissed.
    if (pending && !next) return;
    onOpenChange(next);
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        className={cn(isDestructive && "border-destructive/40")}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {isDestructive && (
              <AlertTriangle
                className="h-5 w-5 shrink-0 text-destructive"
                aria-hidden="true"
              />
            )}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {children}

        {isDestructive && (
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              Type{" "}
              <span className="font-mono font-semibold text-destructive">
                {confirmToken}
              </span>{" "}
              {confirmTokenHint ? `(${confirmTokenHint}) ` : ""}to confirm.
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmToken}
              aria-label={`Type ${confirmToken} to confirm`}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canConfirm) {
                  e.preventDefault();
                  void handleConfirm();
                }
              }}
              className="font-mono"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            className={cn(
              isDestructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            )}
          >
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            {pending ? "Working..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
