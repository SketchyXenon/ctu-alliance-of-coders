"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCw } from "lucide-react";
import { GearLogo } from "@/components/gear-logo";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("[aoc:error-boundary]", error.digest ?? "");
    }
  }, [error]);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-navy-950 to-navy-900 px-4 py-16 text-white">
      <div className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        <GearLogo size={64} className="mb-6" />

        <span className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-red-300">
          Something broke
        </span>

        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
          A runtime error occurred
        </h1>

        <p className="mt-4 max-w-sm text-balance text-sm leading-relaxed text-white/70">
          An unexpected error happened while rendering this page. You can try
          again, or head back to the home page. The issue has been logged.
        </p>

        <div className="mt-8 flex flex-col gap-2 sm:flex-row">
          <Button size="lg" onClick={reset}>
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link
              href="/"
              className="border-white/25 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              <Home className="h-4 w-4" aria-hidden="true" />
              Back to home
            </Link>
          </Button>
        </div>

        {error.digest && (
          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            Reference: {error.digest}
          </p>
        )}

        <AlertTriangle
          className="mt-6 h-4 w-4 text-white/30"
          aria-hidden="true"
        />
      </div>
    </main>
  );
}
