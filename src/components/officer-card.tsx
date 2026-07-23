"use client";

import * as React from "react";
import Image from "next/image";
import { Camera, Upload, User } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Officer } from "@/lib/types";

interface OfficerCardProps {
  officer: Officer;
  editable?: boolean;
  onImageUpload?: (officerId: string, file: File) => void | Promise<void>;
  onClick?: (officer: Officer) => void;
}

const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Derive 2-char uppercase initials from a name.
 * Falls back to "?" when the name is empty.
 */
function getInitials(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + second).toUpperCase().slice(0, 2);
}

/**
 * OfficerCard - a single officer presentation card.
 *
 * Public mode (editable=false): static avatar (image or initials).
 * Admin mode (editable=true): avatar becomes a button that triggers a hidden
 * file input; a "Change Photo" action appears below.
 */
export function OfficerCard({
  officer,
  editable = false,
  onImageUpload,
  onClick,
}: OfficerCardProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);

  const displayName = officer.name?.trim() || "Vacant Slot";
  const displayRole = officer.role?.trim() || "Open Position";
  const initials = getInitials(officer.name);
  const isVacant = !officer.name?.trim();

  const openFilePicker = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Always reset the input value so re-selecting the same file fires change.
      event.target.value = "";
      if (!file) return;

      // Client-side validation
      if (!ACCEPTED_MIME.includes(file.type as (typeof ACCEPTED_MIME)[number])) {
        toast.error("Invalid file type", {
          description: "Please upload a JPEG, PNG, or WebP image.",
        });
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error("File too large", {
          description: "Please upload an image smaller than 5 MB.",
        });
        return;
      }

      if (!onImageUpload) {
        toast.error("Upload unavailable", {
          description: "No upload handler is configured.",
        });
        return;
      }

      try {
        setIsUploading(true);
        await onImageUpload(officer.id, file);
        toast.success("Photo updated", {
          description: `${displayName}'s photo has been updated.`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error("Upload failed", { description: message });
      } finally {
        setIsUploading(false);
      }
    },
    [onImageUpload, officer.id, displayName]
  );

  const avatarContent = officer.image ? (
    <Image
      src={officer.image}
      alt={`${displayName} portrait`}
      fill
      sizes="112px"
      className="object-cover"
    />
  ) : (
    <span
      className={cn(
        "font-display text-2xl font-bold tracking-wide",
        isVacant ? "text-muted-foreground/70" : "text-gold-400"
      )}
      aria-hidden="true"
    >
      {isVacant ? <User className="h-8 w-8" /> : initials}
    </span>
  );

  const isClickable = !editable && !isVacant && Boolean(onClick);

  const handleCardClick = React.useCallback(() => {
    if (isClickable) onClick?.(officer);
  }, [isClickable, onClick, officer]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (!isClickable) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick?.(officer);
      }
    },
    [isClickable, onClick, officer]
  );

  return (
    <Card
      className={cn(
        "group relative w-full items-center gap-4 border-2 px-5 py-6 text-center shadow-sm transition-all duration-200",
        "hover:-translate-y-1 hover:shadow-xl hover:border-gold-300/60",
        "focus-within:shadow-md focus-within:border-gold-300/60",
        isVacant && "opacity-90 border-dashed",
        isClickable && "cursor-pointer"
      )}
      data-officer-id={officer.id}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? `View details for ${displayName}` : undefined}
    >
      {/* Avatar */}
      <div className="relative h-28 w-28 shrink-0">
        {editable ? (
          <button
            type="button"
            onClick={openFilePicker}
            disabled={isUploading}
            aria-label={
              officer.image
                ? `Change photo for ${displayName}`
                : `Upload photo for ${displayName}`
            }
            className={cn(
              "relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full",
              "ring-2 ring-gold-400/40 ring-offset-2 ring-offset-card",
              "bg-navy-700 text-white transition-all duration-200",
              "hover:ring-gold-400 hover:ring-offset-3",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-400/70 focus-visible:ring-offset-2",
              "active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {/* Image / initials layer */}
            <span className="relative block h-full w-full">
              {avatarContent}
            </span>
            {/* Hover overlay */}
            <span
              className={cn(
                "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1",
                "bg-navy-900/70 text-white opacity-0 backdrop-blur-[2px]",
                "transition-opacity duration-200 group-hover:opacity-100",
                "group-focus-visible:opacity-100"
              )}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide">
                {isUploading ? "Uploading" : officer.image ? "Change" : "Upload"}
              </span>
            </span>
          </button>
        ) : (
          <div
            className={cn(
              "relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full",
              "bg-gradient-to-br from-navy-700 to-navy-900",
              "ring-2 ring-gold-400/30 ring-offset-2 ring-offset-card",
              "shadow-md"
            )}
          >
            {avatarContent}
          </div>
        )}

        {/* Hidden file input (only rendered in editable mode) */}
        {editable && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileChange}
            tabIndex={-1}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Name + role */}
      <div className="flex w-full flex-col items-center gap-1">
        <h3
          className={cn(
            "font-display text-base font-semibold leading-tight text-foreground text-balance",
            isVacant && "text-muted-foreground"
          )}
        >
          {displayName}
        </h3>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {displayRole}
        </p>
        {isClickable && (
          <span className="mt-0.5 text-[10px] font-medium text-gold-600 opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:text-gold-400">
            Click for details
          </span>
        )}
      </div>

      {/* Editable: Change Photo action */}
      {editable && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={openFilePicker}
          disabled={isUploading}
          className={cn(
            "mt-1 h-7 gap-1.5 px-2 text-xs text-muted-foreground",
            "hover:bg-gold-100/60 hover:text-gold-800",
            "focus-visible:ring-2 focus-visible:ring-gold-400/60",
            "dark:hover:bg-gold-400/10 dark:hover:text-gold-300"
          )}
        >
          <Camera className="h-3.5 w-3.5" aria-hidden="true" />
          {isUploading ? "Uploading…" : "Change Photo"}
        </Button>
      )}
    </Card>
  );
}

export default OfficerCard;
