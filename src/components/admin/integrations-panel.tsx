"use client";

import * as React from "react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Lock } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { INTEGRATIONS } from "@/lib/constants";

/**
 * IntegrationsPanel - a read-only catalog of integration entry points.
 *
 * Per the task spec: no actual integrations are connected yet. This panel
 * advertises the surface area (REST webhook, Google Workspace, Facebook,
 * Google Forms, Discord, Email) and marks each as "Coming soon" so admins
 * know what's on the roadmap.
 */
export function IntegrationsPanel() {
  return (
    <div className="space-y-5">
      <Card className="border-border/60 bg-gradient-to-br from-primary/5 to-gold-500/5">
        <CardContent className="flex items-start gap-3 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <LucideIcons.Webhook className="size-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="font-display text-base font-semibold">
              Integration Catalog
            </p>
            <p className="text-sm text-muted-foreground">
              Connect external services to automate announcements and sync data.
              Each entry below exposes a documented entry point and will be
              configurable from this panel in a future release.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((integration) => {
          const Icon = resolveIcon(integration.icon);
          return (
            <Card
              key={integration.id}
              className="group relative border-border/60 transition-shadow hover:shadow-md"
            >
              <CardHeader className="gap-3">
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Lock className="size-3" aria-hidden="true" />
                    Planned
                  </span>
                </div>
                <CardTitle className="text-base">{integration.label}</CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  {integration.desc}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="block w-full">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full cursor-not-allowed"
                        disabled
                        aria-disabled="true"
                        aria-label={`Configure ${integration.label} - coming soon`}
                      >
                        <LucideIcons.Settings
                          className="size-3.5"
                          aria-hidden="true"
                        />
                        Configure
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Coming soon</TooltipContent>
                </Tooltip>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Need a custom integration? Reach out via the contact form and we&apos;ll
        scope it with you.
      </p>
    </div>
  );
}

function resolveIcon(name: string): LucideIcon {
  const icons = LucideIcons as unknown as Record<string, LucideIcon>;
  return icons[name] ?? LucideIcons.Plug;
}
