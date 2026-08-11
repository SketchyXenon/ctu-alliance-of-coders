"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Home } from "lucide-react";
import { GearLogo } from "@/components/gear-logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const router = useRouter();
  const goBack = React.useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      router.push("/");
    }
  }, [router]);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-navy-950 to-navy-900 px-4 py-16 text-white">
      <div className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        <GearLogo size={64} className="mb-6" />

        <span className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-gold-300">
          404 - Not found
        </span>

        <h1 className="mt-3 font-display text-5xl font-bold tracking-tight text-white sm:text-6xl">
          Lost in the code
        </h1>

        <p className="mt-4 max-w-sm text-balance text-sm leading-relaxed text-white/70">
          The page you tried to reach does not exist, or it may have been moved.
          Let&apos;s get you back to solid ground.
        </p>

        <div className="mt-8 flex flex-col gap-2 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/">
              <Home className="h-4 w-4" aria-hidden="true" />
              Back to home
            </Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={goBack}
            className="border-white/25 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Go back
          </Button>
        </div>

        <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
          Alliance of Coders
        </p>
      </div>
    </main>
  );
}
