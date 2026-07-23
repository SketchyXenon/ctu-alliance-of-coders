"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useReducedMotion } from "framer-motion";

interface SectionTransitionProps {
  sectionKey: string;
  children: React.ReactNode;
}

/**
 * SectionTransition - wraps section content with a fade+slide-up animation
 * that re-triggers on section change. Respects prefers-reduced-motion.
 */
export function SectionTransition({ sectionKey, children }: SectionTransitionProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={sectionKey}
        initial={
          prefersReducedMotion
            ? { opacity: 0 }
            : { opacity: 0, y: 12 }
        }
        animate={
          prefersReducedMotion
            ? { opacity: 1 }
            : { opacity: 1, y: 0 }
        }
        exit={
          prefersReducedMotion
            ? { opacity: 0 }
            : { opacity: 0, y: -8 }
        }
        transition={{
          duration: prefersReducedMotion ? 0.15 : 0.3,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
