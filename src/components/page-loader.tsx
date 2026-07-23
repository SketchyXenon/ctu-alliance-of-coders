"use client";

import * as React from "react";
import { useId } from "react";
import { ClockLoader } from "react-spinners";
import { cn } from "@/lib/utils";

interface PageLoaderProps {
  title?: string;
  description?: string;
  variant?: "fullscreen" | "inline";
  className?: string;
}

// ClockLoader: clock metaphor suits a loading wait; single-color ring fits the navy/gold system.
export function PageLoader({
  title = "Loading",
  description = "",
  variant = "fullscreen",
  className,
}: PageLoaderProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <div
      className={cn(
        "flex items-center justify-center bg-background",
        variant === "fullscreen" ? "min-h-screen" : "min-h-[40vh]",
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="flex flex-col items-center gap-5 px-6 text-center">
        {/* react-spinners renders inline-styled spans; reduced-motion override in globals.css targets them via .page-loader-spinner. */}
        <div className="page-loader-spinner" aria-hidden="true">
          <ClockLoader color="var(--gold-500)" size={56} />
        </div>

        <div className="space-y-1">
          <h1
            id={titleId}
            className="font-display text-lg font-semibold text-foreground"
          >
            {title}
          </h1>
          {description && (
            <p
              id={descriptionId}
              className="max-w-sm text-sm text-muted-foreground"
            >
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
