import type { AnnouncementType, SectionKey } from "./types";

export interface NavLink {
  key: SectionKey;
  label: string;
}

export const NAV_LINKS: NavLink[] = [
  { key: "Home", label: "Home" },
  { key: "Announcements", label: "Announcements" },
  { key: "Officers", label: "Officers" },
  { key: "Contact", label: "Contact" },
  { key: "FAQ", label: "FAQ" },
  { key: "Admin Panel", label: "Admin Panel" },
];

export interface BadgeConfig {
  className: string;
  label: string;
  accentBar: string;
}

export const BADGE_CONFIG: Record<AnnouncementType, BadgeConfig> = {
  award: {
    className: "badge-award",
    label: "Award",
    accentBar: "accent-bar-award",
  },
  recognition: {
    className: "badge-recognition",
    label: "Recognition",
    accentBar: "accent-bar-recognition",
  },
  report: {
    className: "badge-report",
    label: "Report",
    accentBar: "accent-bar-report",
  },
  general: {
    className: "badge-general",
    label: "General",
    accentBar: "accent-bar-general",
  },
};

export const FILTER_OPTIONS: {
  value: AnnouncementType | "all";
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "award", label: "Awards" },
  { value: "recognition", label: "Recognitions" },
  { value: "report", label: "Reports" },
  { value: "general", label: "General" },
];

export const ANNOUNCEMENT_TYPES: AnnouncementType[] = [
  "general",
  "award",
  "recognition",
  "report",
];

export interface PolicyPage {
  key: SectionKey;
  title: string;
  icon: string;
  eyebrow: string;
  sub: string;
  summary: string;
  bullets: string[];
}

export const POLICY_PAGES: PolicyPage[] = [
  {
    key: "Privacy Policy",
    title: "Privacy Policy",
    icon: "ShieldCheck",
    eyebrow: "Policy Center",
    sub: "What we collect and how we use it.",
    summary:
      "We collect only what's needed to respond to inquiries and manage content.",
    bullets: [
      "Contact submissions are stored for admin review.",
      "Officer images are used only for organization management.",
      "We do not sell personal data.",
    ],
  },
  {
    key: "Data Protection",
    title: "Data Protection",
    icon: "Database",
    eyebrow: "Security Center",
    sub: "How we protect stored data.",
    summary:
      "Access is limited to authenticated admins with server-side authorization.",
    bullets: [
      "Admin actions require a signed-in session.",
      "Every write is re-authorized server-side.",
      "Uploaded content is reviewed periodically.",
    ],
  },
  {
    key: "Terms of Use",
    title: "Terms of Use",
    icon: "FileText",
    eyebrow: "Usage Guide",
    sub: "Using this site.",
    summary: "This site is for the Alliance of Coders community.",
    bullets: [
      "Submit accurate, respectful information.",
      "Admins moderate all content.",
      "Content may change without notice.",
    ],
  },
  {
    key: "Cookie Policy",
    title: "Cookie Policy",
    icon: "Cookie",
    eyebrow: "Browser Storage",
    sub: "How we use local storage.",
    summary:
      "Local storage is used for theme and form drafts only - no ad tracking.",
    bullets: [
      "Theme preference is stored locally.",
      "Forms use local rate-limiting for reliability.",
      "No third-party marketing cookies.",
    ],
  },
];

export function getPolicyPage(key: string): PolicyPage | null {
  return POLICY_PAGES.find((p) => p.key === key) ?? null;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
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

export interface ContactTopic {
  value: string;
  label: string;
}

export const CONTACT_TOPICS: ContactTopic[] = [
  { value: "General Inquiry", label: "General Inquiry" },
  { value: "Membership", label: "Membership" },
  { value: "Events", label: "Events" },
  { value: "Technical Support", label: "Technical Support" },
  { value: "Partnerships", label: "Partnerships" },
  { value: "Other", label: "Other" },
];

export const CONTACT_POINTS = [
  {
    icon: "Mail",
    label: "Email",
    value: "Replies via admin dashboard",
  },
  {
    icon: "Clock",
    label: "Response Time",
    value: "1-3 school days",
  },
  {
    icon: "ShieldCheck",
    label: "Privacy",
    value: "Secure, admin-only access",
  },
];

export interface Integration {
  id: string;
  label: string;
  desc: string;
  icon: string;
}

export const INTEGRATIONS: Integration[] = [
  {
    id: "webhook",
    label: "REST API Webhook",
    desc: "POST /api/announcements to auto-publish from external systems.",
    icon: "Webhook",
  },
  {
    id: "google-workspace",
    label: "Google Workspace",
    desc: "Sync Google Calendar events as announcements.",
    icon: "Calendar",
  },
  {
    id: "facebook",
    label: "Facebook Page Feed",
    desc: "Auto-post announcements via Meta Graph API.",
    icon: "Facebook",
  },
  {
    id: "google-forms",
    label: "Google Forms",
    desc: "Member registration webhook from Google Forms.",
    icon: "ClipboardList",
  },
  {
    id: "discord",
    label: "Discord Bot",
    desc: "Push announcements to a Discord server channel.",
    icon: "MessageSquare",
  },
  {
    id: "email",
    label: "Email Newsletter",
    desc: "Send announcements via Mailchimp or SendGrid SMTP.",
    icon: "Send",
  },
];
