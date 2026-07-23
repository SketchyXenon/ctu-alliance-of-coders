// Shared domain types for Alliance of Coders.
// These mirror the Prisma models but are decoupled so the API can evolve
// without leaking database internals to the client.

export type AnnouncementType = "award" | "recognition" | "report" | "general";

export interface Announcement {
  id: string;
  type: AnnouncementType;
  title: string;
  body: string;
  image: string | null;
  pinned: boolean;
  date: string; // YYYY-MM-DD
}

export interface Officer {
  id: string;
  name: string;
  role: string;
  image: string | null;
  sortOrder: number;
}

export interface AdminYear {
  id: string;
  year: string;
  theme: string;
  sortOrder: number;
  officers: Officer[];
}

export type ContactCategory =
  | "General Inquiry"
  | "Membership"
  | "Events"
  | "Technical Support"
  | "Partnerships"
  | "Other";

export type ContactStatus = "new" | "read" | "resolved" | "archived";

export interface ContactMessage {
  id: string;
  clientId: string;
  name: string;
  email: string;
  subject: string;
  category: ContactCategory;
  message: string;
  status: ContactStatus;
  createdAt: string; // ISO string
}

export interface AdminUserPublic {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export interface SiteData {
  announcements: Announcement[];
  adminYears: AdminYear[];
}

export interface HeroStats {
  value: number;
  label: string;
}

export type SectionKey =
  | "Home"
  | "Announcements"
  | "Officers"
  | "Contact"
  | "Admin Panel"
  | "Privacy Policy"
  | "Data Protection"
  | "Terms of Use"
  | "Cookie Policy";

export interface SyncStatus {
  ready: boolean;
  saving: boolean;
  error: string | null;
  lastSavedAt: number | null;
}
