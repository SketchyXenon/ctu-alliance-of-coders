"use client";

import { motion, useReducedMotion } from "framer-motion";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  sub?: string;
  icon?: keyof typeof LucideIcons | string;
  iconLabel?: string;
  className?: string;
  align?: "left" | "center";
}

/**
 * SectionHeading - consistent section header with eyebrow, title, subtitle.
 * Uses a gold rule as the signature structural device.
 *
 * Animated entrance: eyebrow + title + subtitle + rule fade and slide up
 * in a staggered sequence. Respects prefers-reduced-motion.
 */
export function SectionHeading({
  eyebrow,
  title,
  sub,
  icon,
  iconLabel,
  className,
  align = "left",
}: SectionHeadingProps) {
  const prefersReducedMotion = useReducedMotion();

  const Icon = icon
    ? ((LucideIcons as unknown as Record<string, LucideIcon>)[icon] ?? LucideIcons.Sparkles)
    : null;

  const container = {
    hidden: {},
    show: {
      transition: {
        staggerChildren: prefersReducedMotion ? 0 : 0.08,
        delayChildren: prefersReducedMotion ? 0 : 0.05,
      },
    },
  };
  const item = {
    hidden: prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
    },
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className={cn(
        "section-heading",
        align === "center" && "text-center mx-auto",
        className
      )}
    >
      {(eyebrow || icon) && (
        <motion.div
          variants={item}
          className={cn(
            "inline-flex items-center gap-2 mb-3",
            align === "center" && "justify-center"
          )}
        >
          {Icon && (
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
          {eyebrow && (
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground font-display">
              {eyebrow}
            </span>
          )}
          {icon && iconLabel && <span className="sr-only">{iconLabel}</span>}
        </motion.div>
      )}
      <motion.h2
        variants={item}
        className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-balance"
      >
        {title}
      </motion.h2>
      {sub && (
        <motion.p
          variants={item}
          className="mt-3 max-w-2xl text-base text-muted-foreground leading-relaxed text-balance"
        >
          {sub}
        </motion.p>
      )}
      <motion.div
        variants={item}
        className="mt-5 h-1 w-16 rounded-full bg-gradient-to-r from-gold-500 to-gold-300"
      />
    </motion.div>
  );
}
