"use client";

import * as React from "react";

import { SectionHeading } from "@/components/section-heading";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FAQ_ITEMS } from "@/lib/constants";
import { usePageStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * FaqSection - accordion-style frequently asked questions.
 * Uses the shadcn/ui Accordion (Radix-based) for accessible expand/collapse.
 * FAQ_ITEMS live in constants.ts so the chatbot shares the same source of truth.
 * Per 05 §4: semantic HTML, keyboard accessible, full state set.
 */
export function FaqSection() {
  // Navigate directly via the shared store. Dispatching a synthetic Cmd+K
  // here opened the command palette instead of the contact section.
  const setActiveNav = usePageStore((s) => s.setActiveNav);

  function goToContact() {
    setActiveNav("Contact");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:py-20"
    >
      <SectionHeading
        id="faq-heading"
        eyebrow="Help Center"
        title="Frequently Asked Questions"
        sub="Common questions about the Alliance of Coders website."
        icon="HelpCircle"
        iconLabel="FAQ"
      />

      <div className="mx-auto mt-8 max-w-3xl">
        <Accordion type="single" collapsible className="w-full">
          {FAQ_ITEMS.map((item, index) => (
            <AccordionItem
              key={index}
              value={`item-${index}`}
              className={cn(
                "rounded-lg border-2 border-border/60 bg-card px-4 sm:px-5",
                "mb-3 shadow-sm transition-colors",
                "data-[state=open]:border-teal-300/60",
              )}
            >
              <AccordionTrigger
                className={cn(
                  "text-left text-base font-semibold text-foreground",
                  "hover:no-underline hover:text-teal-700 dark:hover:text-teal-300",
                  "focus-visible:ring-2 focus-visible:ring-teal-400/40",
                )}
              >
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Still have questions?{" "}
          <button
            type="button"
            onClick={goToContact}
            className="font-medium text-teal-600 underline-offset-2 hover:underline dark:text-teal-400"
          >
            Use the contact form
          </button>{" "}
          and we will get back to you.
        </p>
      </div>
    </section>
  );
}

export default FaqSection;
