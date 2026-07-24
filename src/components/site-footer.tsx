"use client";

import * as React from "react";
import {
  Cookie,
  Database,
  Facebook,
  FileText,
  Github,
  HelpCircle,
  Home,
  LayoutDashboard,
  Link as LinkIcon,
  Mail,
  Megaphone,
  MessageSquare,
  Share2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { GearLogo } from "@/components/gear-logo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { NAV_LINKS, POLICY_PAGES } from "@/lib/constants";
import { getSocialLinks } from "@/lib/site-config";
import { usePageStore } from "@/lib/store";
import type { SectionKey } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Icon registry mapping each social icon name to a Lucide component.
 * Resolves the string icon names from getSocialLinks() to components.
 */
const SOCIAL_ICONS: Record<string, LucideIcon> = {
  Facebook,
  Github,
  Mail,
};

/**
 * Icon registry mapping each section key to a Lucide icon.
 * Kept here (not in constants.ts) because only the footer surfaces these
 * icons today; the nav uses pure text + underline indicator.
 */
const NAV_ICONS: Partial<Record<SectionKey, LucideIcon>> = {
  Home: Home,
  Announcements: Megaphone,
  Officers: Users,
  Contact: MessageSquare,
  FAQ: HelpCircle,
  "Admin Panel": LayoutDashboard,
};

/**
 * Policy icon registry. The `icon` field on POLICY_PAGES is a string
 * (kept serializable in constants.ts), so we resolve it to a component here.
 */
const POLICY_ICONS: Record<string, LucideIcon> = {
  ShieldCheck,
  Database,
  FileText,
  Cookie,
};

/**
 * SiteFooter - site-wide footer with brand, quick links, socials, and policies.
 *
 * The root <footer> uses `mt-auto` so that when the page wrapper is
 * `min-h-screen flex flex-col`, this footer pins to the viewport bottom on
 * short pages and stacks naturally after long content.
 */
export function SiteFooter() {
  const setActiveNav = usePageStore((s) => s.setActiveNav);
  const year = React.useMemo(() => new Date().getFullYear(), []);
  const socialLinks = React.useMemo(() => getSocialLinks(), []);

  return (
    <footer
      className={cn(
        "mt-auto w-full border-t border-border no-print",
        "bg-gradient-to-b from-background via-background to-muted/50",
        "text-foreground",
      )}
    >
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {/* Brand column */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <GearLogo size={44} />
              <span className="flex flex-col leading-tight">
                <span className="font-display text-lg font-bold tracking-tight text-foreground">
                  Alliance of Coders
                </span>
                <span className="text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  CTU Danao Campus
                </span>
              </span>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              Developers, innovators, and tech leaders at CTU Danao Campus.
            </p>
          </div>

          {/* Quick Links column */}
          <nav aria-label="Quick links" className="flex flex-col gap-3">
            <FooterHeading icon={LinkIcon}>Quick Links</FooterHeading>
            <ul className="flex flex-col gap-0.5">
              {NAV_LINKS.map((link) => {
                const Icon = NAV_ICONS[link.key];
                return (
                  <li key={link.key}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveNav(link.key)}
                      className={cn(
                        "group h-9 w-full justify-start gap-2.5 px-2 text-left text-sm font-medium",
                        "text-muted-foreground transition-all duration-200",
                        "hover:bg-accent/60 hover:text-foreground hover:translate-x-0.5",
                        "focus-visible:bg-accent/60 focus-visible:text-foreground",
                      )}
                    >
                      {Icon ? (
                        <Icon
                          className="size-4 shrink-0 text-gold-500 transition-transform duration-200 group-hover:scale-110"
                          aria-hidden="true"
                        />
                      ) : null}
                      {link.label}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Socials column - only rendered if at least one social link is configured in env */}
          {socialLinks.length > 0 && (
            <div className="flex flex-col gap-3">
              <FooterHeading icon={Share2}>Socials</FooterHeading>
              <ul className="flex flex-col gap-0.5">
                {socialLinks.map((social) => {
                  const Icon = SOCIAL_ICONS[social.icon] ?? LinkIcon;
                  return (
                    <li key={social.key}>
                      <a
                        href={social.href ?? "#"}
                        target={social.href?.startsWith("mailto:") ? "_self" : "_blank"}
                        rel="noopener noreferrer"
                        className={cn(
                          "group flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm font-medium",
                          "text-muted-foreground transition-all duration-200",
                          "hover:bg-accent/60 hover:text-foreground hover:translate-x-0.5",
                          "focus-visible:bg-accent/60 focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <Icon
                          className="size-4 shrink-0 text-gold-500 transition-transform duration-200 group-hover:scale-110"
                          aria-hidden="true"
                        />
                        {social.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Policies column */}
          <nav aria-label="Policies" className="flex flex-col gap-3">
            <FooterHeading icon={ShieldCheck}>Policies</FooterHeading>
            <ul className="flex flex-col gap-0.5">
              {POLICY_PAGES.map((policy) => {
                const Icon = POLICY_ICONS[policy.icon] ?? ShieldCheck;
                return (
                  <li key={policy.key}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveNav(policy.key)}
                      className={cn(
                        "group h-9 w-full justify-start gap-2.5 px-2 text-left text-sm font-medium",
                        "text-muted-foreground transition-all duration-200",
                        "hover:bg-accent/60 hover:text-foreground hover:translate-x-0.5",
                        "focus-visible:bg-accent/60 focus-visible:text-foreground",
                      )}
                    >
                      <Icon
                        className="size-4 shrink-0 text-gold-500 transition-transform duration-200 group-hover:scale-110"
                        aria-hidden="true"
                      />
                      {policy.title}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </div>

      <Separator />

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <p className="text-center text-xs text-muted-foreground">
          &copy; {year} Alliance of Coders - CTU Danao Campus. All rights
          reserved.
        </p>
      </div>
    </footer>
  );
}

interface FooterHeadingProps {
  icon: LucideIcon;
  children: React.ReactNode;
}

function FooterHeading({ icon: Icon, children }: FooterHeadingProps) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
      <Icon
        className="size-4 text-gold-500"
        aria-hidden="true"
      />
      {children}
    </h3>
  );
}
