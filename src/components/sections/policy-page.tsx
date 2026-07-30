"use client";

import * as React from "react";
import { Check, Info, Printer, type LucideIcon } from "lucide-react";
import * as LucideIcons from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SectionHeading } from "@/components/section-heading";
import type { PolicyPage } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface PolicyPageProps {
  policy: PolicyPage;
}

const QUICK_NOTES: string[] = [
  "Managed by the Alliance of Coders admin team.",
  "Backed by server-side authorization and session auth.",
  "Designed to support community communication and content updates.",
];

const POLICY_ICON_FALLBACK = LucideIcons.FileText;

export function PolicyPageSection({ policy }: PolicyPageProps) {
  const Icon = React.useMemo<LucideIcon>(() => {
    if (!policy.icon) return POLICY_ICON_FALLBACK;
    return (
      (LucideIcons as unknown as Record<string, LucideIcon>)[policy.icon] ??
      POLICY_ICON_FALLBACK
    );
  }, [policy.icon]);

  return (
    <section
      id={`policy-${policy.key.toLowerCase().replace(/\s+/g, "-")}`}
      aria-labelledby="policy-heading"
      className="policy-page relative mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:py-20"
    >
      <div className="flex items-start justify-between gap-4">
        <SectionHeading
          eyebrow={policy.eyebrow}
          title={policy.title}
          sub={policy.sub}
          icon={policy.icon}
          iconLabel={policy.title}
        />
        <Button
          variant="outline"
          size="sm"
          className="no-print mt-1 shrink-0"
          onClick={() => typeof window !== "undefined" && window.print()}
          aria-label={`Print ${policy.title}`}
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Print</span>
        </Button>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[8fr_4fr]">
        {/* MAIN */}
        <Card className="border-2 border-border/60 shadow-sm">
          {/* Top accent bar - gold gradient, frames the policy */}
          <div className="h-1 w-full rounded-t-lg bg-gradient-to-r from-gold-500 via-gold-400 to-gold-300" />
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <CardTitle className="font-display text-xl">
                  {policy.title}
                </CardTitle>
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                Last updated: July 2026
              </span>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="flex flex-col gap-8 pt-6">
            {/* Lead summary */}
            <p className="text-lg font-medium leading-relaxed text-foreground text-balance">
              {policy.summary}
            </p>

            {/* Bullets */}
            <ul className="flex flex-col gap-4">
              {policy.bullets.map((bullet, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                      "bg-[var(--color-success-bg)] text-[var(--color-success-fg)]",
                      "ring-1 ring-[var(--color-success-border)]",
                    )}
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <p className="text-sm leading-7 text-foreground/90 sm:text-base sm:leading-8">
                    {bullet}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* SIDEBAR */}
        <Card className="border-2 border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle className="font-display text-lg">Quick Notes</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="flex flex-col gap-5 pt-6">
            <p className="text-sm leading-relaxed text-muted-foreground">
              This section is part of the Alliance of Coders policy center. A
              few things to keep in mind while reviewing the details on the
              left.
            </p>
            <ul className="flex flex-col gap-3">
              {QUICK_NOTES.map((note, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <Info
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span className="text-sm leading-relaxed text-foreground/90">
                    {note}
                  </span>
                </li>
              ))}
            </ul>

            <div
              className="mt-2 rounded-lg border border-dashed p-4"
              style={{ borderColor: "var(--color-border-mid)" }}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">
                Questions about this policy? Use the contact form to reach the
                admin team - choose &ldquo;Technical Support&rdquo; as the
                topic.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

export { PolicyPageSection as PolicyPage };
