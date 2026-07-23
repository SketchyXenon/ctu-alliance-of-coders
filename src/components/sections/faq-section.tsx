"use client";

import * as React from "react";

import { SectionHeading } from "@/components/section-heading";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

interface FAQItem {
  question: string;
  answer: string;
}

/**
 * FAQ items. The primary question ("Why was this website created?") is listed
 * first - it's the core purpose statement. Per 05-ui-ux-design.md section 8:
 * FAQ content supports FAQPage structured data (added in layout.tsx).
 */
const FAQ_ITEMS: FAQItem[] = [
  {
    question: "Why was this website created?",
    answer:
      "This website was created so members, alumni, and partners can fully access the latest information and latest updates from the Alliance of Coders. Announcements, officer rosters, and organizational activities are published here as they happen - no more relying on scattered social media posts or word of mouth.",
  },
  {
    question: "What kind of updates can I find here?",
    answer:
      "You will find awards, recognitions, accomplishment reports, general announcements, and the current leadership roster. The Announcements section is updated whenever there is new news, and the Officers section reflects the current academic year's leadership team.",
  },
  {
    question: "How often is the information updated?",
    answer:
      "The admin team publishes updates as events happen - there is no fixed schedule. When the organization earns an award, holds a general assembly, or changes leadership, the site is updated within a few days. Check the Announcements section for the most recent posts.",
  },
  {
    question: "Can I contact the organization through this site?",
    answer:
      "Yes. The Contact section has a form that sends a message directly to the admin team. Choose the topic that best fits your inquiry so it reaches the right person. Expect a response within 1-3 school days.",
  },
  {
    question: "Who manages the content on this site?",
    answer:
      "Content is managed by authenticated administrators of the Alliance of Coders. Every change is logged in an audit trail, and only authorized admins can create, edit, or delete announcements and officer records.",
  },
  {
    question: "Is my data safe when I use the contact form?",
    answer:
      "Your contact submission is stored securely and accessible only to authenticated admins. We do not sell personal data, and we do not use third-party tracking cookies. See our Privacy Policy and Data Protection pages for full details.",
  },
];

/**
 * FaqSection - accordion-style frequently asked questions.
 * Uses the shadcn/ui Accordion (Radix-based) for accessible expand/collapse.
 * Per 05 §4: semantic HTML, keyboard accessible, full state set.
 */
export function FaqSection() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:py-20"
    >
      <SectionHeading
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
                "data-[state=open]:border-gold-300/60",
              )}
            >
              <AccordionTrigger
                className={cn(
                  "text-left text-base font-semibold text-foreground",
                  "hover:no-underline hover:text-gold-700 dark:hover:text-gold-300",
                  "focus-visible:ring-2 focus-visible:ring-gold-400/40",
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
            onClick={() => {
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
            }}
            className="font-medium text-gold-600 underline-offset-2 hover:underline dark:text-gold-400"
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
