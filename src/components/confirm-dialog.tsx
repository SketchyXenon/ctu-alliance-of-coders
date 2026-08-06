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

export type ConfirmMode = "destructive" | "soft";

export function canConfirmAction(opts: {
  mode: ConfirmMode;
  typed: string;
  confirmToken: string;
  pending: boolean;
}): boolean {
  const { mode, typed, confirmToken, pending } = opts;
  if (pending) return false;

  if (mode !== "destructive") return true;

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

  React.useEffect(() => {
    if (!open) {
      setTyped("");
      setPending(false);
      setError(null);
    }
  }, [open]);

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

      onOpenChange(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Action failed. Please try again.",
      );
      setPending(false);
    }
  }

  function handleOpenChange(next: boolean) {
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
          <AlertDialogCancel disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            className={cn(
              isDestructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {pending && (
              <Loader2
                className="mr-1.5 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            )}
            {pending ? "Working..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
