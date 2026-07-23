"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Info,
  Mail,
  MapPin,
  Send,
  Users,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeading } from "@/components/section-heading";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CONTACT_TOPICS } from "@/lib/constants";
import {
  generateToken,
  validateEmail,
  validateText,
} from "@/lib/security";

interface ContactSectionProps {
  onSubmit: (message: {
    clientId: string;
    name: string;
    email: string;
    subject: string;
    category: string;
    message: string;
  }) => Promise<void>;
}

const MAX_SUBMITS = 3;
const WINDOW_MS = 10 * 60 * 1000;

interface FormState {
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
}

const INITIAL_FORM: FormState = {
  name: "",
  email: "",
  subject: "",
  category: "General Inquiry",
  message: "",
};

export function ContactSection({ onSubmit }: ContactSectionProps) {
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const [status, setStatus] = React.useState<{ type: "error" | "success" | null; message: string }>({
    type: null,
    message: "",
  });
  const [submitting, setSubmitting] = React.useState(false);
  const submitTimesRef = React.useRef<number[]>([]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    if (status.type) setStatus({ type: null, message: "" });
  }

  function validate(): boolean {
    const nextErrors: Partial<Record<keyof FormState, string>> = {};

    const nameCheck = validateText(form.name, { required: true, minLen: 2, maxLen: 80 });
    if (!nameCheck.valid) nextErrors.name = nameCheck.error!;

    const emailCheck = validateEmail(form.email);
    if (!emailCheck.valid) nextErrors.email = emailCheck.error!;

    const subjectCheck = validateText(form.subject, { required: true, minLen: 3, maxLen: 120 });
    if (!subjectCheck.valid) nextErrors.subject = subjectCheck.error!;

    const messageCheck = validateText(form.message, { required: true, minLen: 10, maxLen: 2000 });
    if (!messageCheck.valid) nextErrors.message = messageCheck.error!;

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    // Client-side rate limit.
    const now = Date.now();
    submitTimesRef.current = submitTimesRef.current.filter((t) => now - t < WINDOW_MS);
    if (submitTimesRef.current.length >= MAX_SUBMITS) {
      const oldest = submitTimesRef.current[0];
      const waitSec = Math.ceil((WINDOW_MS - (now - oldest)) / 1000);
      setStatus({
        type: "error",
        message: `Too many submissions. Please wait ${waitSec}s.`,
      });
      return;
    }

    if (!validate()) return;

    setSubmitting(true);
    setStatus({ type: null, message: "" });

    try {
      const clientId = generateToken();
      await onSubmit({
        clientId,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        subject: form.subject.trim(),
        category: form.category,
        message: form.message.trim(),
      });

      submitTimesRef.current.push(Date.now());
      setStatus({
        type: "success",
        message: "Your message was sent. The admin team will review it.",
      });
      setForm(INITIAL_FORM);
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to send message.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      id="contact"
      aria-labelledby="contact-heading"
      className="relative mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:py-20"
    >
      <SectionHeading
        eyebrow="Contact"
        title="Get in touch"
        sub="Send a message to the admin team."
        icon="Mail"
        iconLabel="Contact"
      />

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[5fr_7fr]">
        {/* Contact info sidebar */}
        <div className="flex flex-col gap-4">
          <Card className="overflow-hidden border-2 border-navy-600 bg-gradient-to-br from-navy-700 to-navy-900 text-white shadow-lg">
            <CardContent className="space-y-5 p-6">
              <div className="space-y-1">
                <h3 className="font-display text-lg font-bold text-gold-300">
                  Reach the admin team
                </h3>
                <p className="text-sm leading-relaxed text-navy-100/80">
                  We respond to every legitimate inquiry. Pick the topic that
                  best fits your message so it reaches the right person.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold-300 ring-1 ring-inset ring-white/15">
                    <Clock className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gold-300/90">
                      Response time
                    </p>
                    <p className="text-sm text-navy-100/90">1-3 school days</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold-300 ring-1 ring-inset ring-white/15">
                    <Mail className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gold-300/90">
                      Email
                    </p>
                    <p className="text-sm text-navy-100/90">
                      allianceofcoders@ctu.edu.ph
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold-300 ring-1 ring-inset ring-white/15">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gold-300/90">
                      Location
                    </p>
                    <p className="text-sm text-navy-100/90">
                      CTU Danao Campus, Cebu
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold-300 ring-1 ring-inset ring-white/15">
                    <Users className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gold-300/90">
                      Audience
                    </p>
                    <p className="text-sm text-navy-100/90">
                      Members, alumni, and partners
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Form card */}
        <Card className="border-2 border-border/60 shadow-md">
        <CardContent className="pt-6">
          <form
            noValidate
            onSubmit={handleSubmit}
            className="flex flex-col gap-5"
            aria-describedby="contact-status"
          >
            {/* Status */}
            <div id="contact-status" aria-live="polite" aria-atomic="true" className="sr-only">
              {status.type ? status.message : ""}
            </div>

            {status.type === "error" && (
              <Alert role="alert" variant="destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>{status.message}</AlertDescription>
              </Alert>
            )}
            {status.type === "success" && (
              <Alert
                role="status"
                className="border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-[var(--color-success-fg)]"
              >
                <CheckCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>{status.message}</AlertDescription>
              </Alert>
            )}

            {/* Name + Email */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-name" className="text-sm font-medium">
                  Name <span aria-hidden="true" className="text-destructive">*</span>
                </Label>
                <Input
                  id="contact-name"
                  name="name"
                  autoComplete="name"
                  placeholder="Juan dela Cruz"
                  maxLength={80}
                  required
                  aria-required="true"
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? "contact-name-error" : undefined}
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  disabled={submitting}
                />
                {errors.name && (
                  <p id="contact-name-error" role="alert" className="text-xs font-medium text-destructive">
                    {errors.name}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-email" className="text-sm font-medium">
                  Email <span aria-hidden="true" className="text-destructive">*</span>
                </Label>
                <Input
                  id="contact-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="juan@example.com"
                  maxLength={254}
                  required
                  aria-required="true"
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "contact-email-error" : undefined}
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  disabled={submitting}
                />
                {errors.email && (
                  <p id="contact-email-error" role="alert" className="text-xs font-medium text-destructive">
                    {errors.email}
                  </p>
                )}
              </div>
            </div>

            {/* Subject + Topic */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-subject" className="text-sm font-medium">
                  Subject <span aria-hidden="true" className="text-destructive">*</span>
                </Label>
                <Input
                  id="contact-subject"
                  name="subject"
                  placeholder="What is this about?"
                  maxLength={120}
                  required
                  aria-required="true"
                  aria-invalid={!!errors.subject}
                  aria-describedby={errors.subject ? "contact-subject-error" : undefined}
                  value={form.subject}
                  onChange={(e) => setField("subject", e.target.value)}
                  disabled={submitting}
                />
                {errors.subject && (
                  <p id="contact-subject-error" role="alert" className="text-xs font-medium text-destructive">
                    {errors.subject}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-topic" className="text-sm font-medium">
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 cursor-help">
                          Topic
                          <Info className="size-3 text-muted-foreground" aria-hidden="true" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-[200px] text-xs">Select the category that best fits your message.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setField("category", v)}
                >
                  <SelectTrigger id="contact-topic" disabled={submitting}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_TOPICS.map((topic) => (
                      <SelectItem key={topic.value} value={topic.value}>
                        {topic.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Message */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="contact-message" className="text-sm font-medium">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 cursor-help">
                        Message
                        <span aria-hidden="true" className="text-destructive">*</span>
                        <Info className="size-3 text-muted-foreground" aria-hidden="true" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-[220px] text-xs">Minimum 10 characters. Be clear and concise.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Textarea
                id="contact-message"
                name="message"
                rows={6}
                maxLength={2000}
                required
                aria-required="true"
                aria-invalid={!!errors.message}
                aria-describedby={errors.message ? "contact-message-error" : undefined}
                placeholder="Write your message here."
                value={form.message}
                onChange={(e) => setField("message", e.target.value)}
                disabled={submitting}
              />
              <div className="flex items-center justify-between">
                {errors.message ? (
                  <p id="contact-message-error" role="alert" className="text-xs font-medium text-destructive">
                    {errors.message}
                  </p>
                ) : (
                  <span />
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {form.message.length}/2000
                </span>
              </div>
            </div>

            {/* Submit */}
            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                disabled={submitting}
                size="lg"
                className="w-full gap-2 transition-all hover:-translate-y-0.5 active:translate-y-0 sm:w-auto"
              >
                {submitting ? (
                  <>
                    <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="size-4" aria-hidden="true" />
                    Send Message
                  </>
                )}
              </Button>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3" aria-hidden="true" />
                Replies within 1-3 school days.
              </p>
            </div>
          </form>
        </CardContent>
        </Card>
      </div>
    </section>
  );
}
