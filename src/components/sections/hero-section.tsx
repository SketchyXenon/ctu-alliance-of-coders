"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Megaphone, MessageSquare, Users } from "lucide-react";
import { useCountUp } from "@/hooks/use-count-up";
import type { HeroStats, SectionKey } from "@/lib/types";

interface HeroSectionProps {
  stats: HeroStats[];
  onNav: (section: SectionKey) => void;
}

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function HeroSection({ stats, onNav }: HeroSectionProps) {
  const prefersReducedMotion = useReducedMotion();

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
    hidden: prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: EASE_OUT },
    },
  };

  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate flex min-h-[calc(100vh-72px)] w-full items-center overflow-hidden text-white"
    >
      {/* Background image with navy overlay */}
      <div className="absolute inset-0 -z-10">
        <img
          src="/background.jpg"
          alt=""
          className="h-full w-full object-cover"
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-navy-950/80" />
        <div className="absolute inset-0 bg-gradient-to-br from-navy-950/70 via-navy-900/50 to-navy-800/70" />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-6 py-16 sm:px-8 lg:py-24">
        <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-between">
          {/* Text content column */}
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="flex flex-1 flex-col items-start gap-7 sm:gap-8"
          >
          <motion.div variants={item} className="flex items-center gap-3">
            <span aria-hidden="true" className="h-px w-8 bg-gold-400 sm:w-10" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-300 sm:text-sm">
              Cebu Technological University - Danao Campus
            </span>
          </motion.div>

          <motion.h1
            id="hero-title"
            variants={item}
            className="font-display text-5xl font-bold leading-[1.02] tracking-tight text-balance sm:text-6xl lg:text-7xl"
          >
            Alliance of <span className="text-gold-400">Coders</span>
          </motion.h1>

          <motion.p
            variants={item}
            className="max-w-xl text-lg leading-relaxed text-navy-100/90 sm:text-xl"
          >
            A community of developers, innovators, and tech leaders at CTU Danao.
          </motion.p>

          <motion.div variants={item} className="flex flex-wrap gap-3 pt-1">
            <HeroButton
              variant="primary"
              icon={<Megaphone className="size-4" aria-hidden="true" />}
              onClick={() => onNav("Announcements")}
            >
              View Announcements
            </HeroButton>
            <HeroButton
              variant="outline"
              icon={<Users className="size-4" aria-hidden="true" />}
              onClick={() => onNav("Officers")}
            >
              Meet Our Officers
            </HeroButton>
            <HeroButton
              variant="outline"
              icon={<MessageSquare className="size-4" aria-hidden="true" />}
              onClick={() => onNav("Contact")}
            >
              Send Feedback
            </HeroButton>
          </motion.div>

          {stats.length > 0 && (
            <motion.div
              variants={item}
              role="list"
              aria-label="Organization statistics"
              className="mt-4 grid w-full grid-cols-2 gap-x-4 gap-y-6 border-t border-white/10 pt-8 sm:mt-6 sm:max-w-2xl sm:grid-cols-4 sm:gap-x-0 sm:divide-x sm:divide-white/10"
            >
              {stats.map(({ value, label }) => (
                <div key={label} role="listitem" className="sm:px-4 sm:first:pl-0">
                  <AnimatedStat value={value} />
                  <div className="mt-1 text-xs uppercase tracking-wider text-navy-100/80 sm:text-sm">
                    {label}
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </motion.div>

          {/* Logo column - right side on desktop, centered above text on mobile */}
          <motion.div
            variants={item}
            initial="hidden"
            animate="show"
            className="flex shrink-0 justify-center lg:justify-end"
          >
            <div className="inline-flex items-center justify-center rounded-2xl bg-white/5 p-3 ring-1 ring-gold-400/30 shadow-2xl shadow-navy-950/50 backdrop-blur-sm">
              <img
                src="/logo.svg"
                alt="Alliance of Coders logo"
                width={96}
                height={96}
                className="block h-24 w-24 sm:h-28 sm:w-28 lg:h-32 lg:w-32"
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

interface HeroButtonProps {
  children: ReactNode;
  variant: "primary" | "outline";
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

function HeroButton({
  children,
  variant,
  icon,
  onClick,
  disabled,
}: HeroButtonProps) {
  const base =
    "inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0";

  const variants: Record<HeroButtonProps["variant"], string> = {
    primary:
      "bg-gold-500 text-navy-950 shadow-lg shadow-gold-500/20 hover:bg-gold-400 hover:shadow-gold-400/30",
    outline:
      "border border-white/30 bg-white/5 text-white backdrop-blur-sm hover:border-gold-400 hover:bg-white/10 hover:text-gold-200",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]}`}
    >
      {icon}
      {children}
    </button>
  );
}

function AnimatedStat({ value }: { value: number }) {
  const animated = useCountUp(value, 1400, 400);
  return (
    <div className="font-display text-3xl font-bold text-gold-400 tabular-nums">
      {animated}
    </div>
  );
}

export default HeroSection;
