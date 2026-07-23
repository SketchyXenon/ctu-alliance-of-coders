"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { PageLoader } from "@/components/page-loader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTheme } from "next-themes";
import { api } from "@/lib/api-client";
import { usePageStore } from "@/lib/store";
import { getPolicyPage } from "@/lib/constants";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useCommandPaletteShortcut } from "@/hooks/use-command-palette-shortcut";
import { BackToTop } from "@/components/back-to-top";
import { CommandPalette } from "@/components/command-palette";
import { CookieConsent } from "@/components/cookie-consent";
import { FeaturedOfficers } from "@/components/featured-officers";
import { ReadingProgress } from "@/components/reading-progress";
import { RecentActivity } from "@/components/recent-activity";
import { SectionTransition } from "@/components/section-transition";
import { ShortcutHelp } from "@/components/shortcut-help";
import type {
  Announcement,
  ContactMessage,
  HeroStats,
  SiteData,
  SectionKey,
} from "@/lib/types";

// Lazy-load the section components so the server only bundles the active
// section instead of all of them at once. This keeps the dev-server memory
// footprint manageable in the sandbox.
const HeroSection = dynamic(
  () => import("@/components/sections/hero-section").then((m) => m.HeroSection),
  { ssr: false },
);
const AnnouncementsSection = dynamic(
  () =>
    import("@/components/sections/announcements-section").then(
      (m) => m.AnnouncementsSection,
    ),
  { ssr: false },
);
const OfficersSection = dynamic(
  () =>
    import("@/components/sections/officers-section").then(
      (m) => m.OfficersSection,
    ),
  { ssr: false },
);
const ContactSection = dynamic(
  () =>
    import("@/components/sections/contact-section").then(
      (m) => m.ContactSection,
    ),
  { ssr: false },
);
const PolicyPageSection = dynamic(
  () =>
    import("@/components/sections/policy-page").then(
      (m) => m.PolicyPageSection,
    ),
  { ssr: false },
);
const FaqSection = dynamic(
  () => import("@/components/sections/faq-section").then((m) => m.FaqSection),
  { ssr: false },
);
const AdminPanel = dynamic(
  () => import("@/components/sections/admin-panel").then((m) => m.AdminPanel),
  { ssr: false },
);

type ConfirmConfig = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive: boolean;
  resolve: (ok: boolean) => void;
};

export default function Home() {
  const {
    activeNav,
    setActiveNav,
    announcements,
    setAnnouncements,
    adminYears,
    setAdminYears,
    setPendingMessages,
    isAdmin,
    setIsAdmin,
    setAdminEmail,
    syncStatus,
    setSyncStatus,
    initialized,
    setInitialized,
  } = usePageStore();

  const [confirm, setConfirm] = React.useState<ConfirmConfig | null>(null);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  // ---- Initial data fetch -----------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setSyncStatus({ ready: false, saving: false, error: null });
      const { data, error } = await api.get<{ data: SiteData }>(
        "/api/site-data",
      );
      if (cancelled) return;
      if (error || !data) {
        setSyncStatus({
          ready: true,
          saving: false,
          error: error?.message ?? "Failed to load site data",
          lastSavedAt: null,
        });
        setInitialized(true);
        return;
      }
      setAnnouncements(data.data.announcements);
      setAdminYears(data.data.adminYears);
      setSyncStatus({
        ready: true,
        saving: false,
        error: null,
        lastSavedAt: Date.now(),
      });
      setInitialized(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Session check -----------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    async function check() {
      const { data } = await api.get<{
        user: {
          id: string;
          email: string;
          name: string | null;
          role: string;
        } | null;
      }>("/api/auth/session");
      if (cancelled) return;
      if (data?.user && data.user.role === "admin") {
        setIsAdmin(true);
        setAdminEmail(data.user.email);
        // Load admin-only inbox.
        const inbox = await api.get<{ items: ContactMessage[] }>(
          "/api/contact",
        );
        if (!cancelled && inbox.data) {
          setPendingMessages(inbox.data.items);
        }
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Theme toggle (for keyboard shortcut) -----------------------------
  const { setTheme, theme } = useTheme();
  const toggleTheme = React.useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  // ---- Navigation handler -----------------------------------------------
  const handleNav = React.useCallback(
    (section: SectionKey) => {
      setActiveNav(section);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [setActiveNav],
  );

  // ---- Keyboard shortcuts (1-5 nav, T theme) -----------------------------
  useKeyboardShortcuts(handleNav, toggleTheme, () => setHelpOpen((o) => !o));
  useCommandPaletteShortcut(() => setPaletteOpen((o) => !o));

  // ---- Confirm dialog helper --------------------------------------------
  function promptConfirm(opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    destructive?: boolean;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirm({
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? "Confirm",
        destructive: opts.destructive ?? true,
        resolve,
      });
    });
  }

  function resolveConfirm(ok: boolean) {
    confirm?.resolve(ok);
    setConfirm(null);
  }

  // ---- Announcement CRUD -------------------------------------------------
  async function addAnnouncement(
    ann: Omit<Announcement, "date"> & { date?: string },
  ) {
    setSyncStatus({ saving: true, error: null });
    const payload = {
      title: ann.title,
      body: ann.body,
      type: ann.type,
      image: ann.image,
      pinned: ann.pinned,
    };
    const { data, error } = await api.post<{ item: Announcement }>(
      "/api/announcements",
      payload,
    );
    setSyncStatus({
      saving: false,
      error: error?.message ?? null,
      lastSavedAt: Date.now(),
    });
    if (error || !data) return;
    setAnnouncements([data.item, ...usePageStore.getState().announcements]);
  }

  async function updateAnnouncement(ann: Announcement) {
    setSyncStatus({ saving: true, error: null });
    const { data, error } = await api.patch<{ item: Announcement }>(
      `/api/announcements/${ann.id}`,
      {
        title: ann.title,
        body: ann.body,
        type: ann.type,
        image: ann.image,
        pinned: ann.pinned,
      },
    );
    setSyncStatus({
      saving: false,
      error: error?.message ?? null,
      lastSavedAt: Date.now(),
    });
    if (error || !data) return;
    setAnnouncements(
      usePageStore
        .getState()
        .announcements.map((a) => (a.id === ann.id ? data.item : a)),
    );
  }

  async function deleteAnnouncement(id: string): Promise<boolean> {
    const ok = await promptConfirm({
      title: "Delete announcement",
      message:
        "Are you sure you want to permanently delete this announcement? This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return false;
    setSyncStatus({ saving: true, error: null });
    const { error } = await api.delete(`/api/announcements/${id}`);
    setSyncStatus({
      saving: false,
      error: error?.message ?? null,
      lastSavedAt: Date.now(),
    });
    if (error) return false;
    setAnnouncements(
      usePageStore.getState().announcements.filter((a) => a.id !== id),
    );
    return true;
  }

  // ---- Contact submit ----------------------------------------------------
  async function submitContact(message: {
    clientId: string;
    name: string;
    email: string;
    subject: string;
    category: string;
    message: string;
  }) {
    const { data, error } = await api.post<{ item: ContactMessage }>(
      "/api/contact",
      message,
    );
    if (error || !data) {
      throw new Error(error?.message ?? "Failed to send message.");
    }
    // If admin is viewing, surface in inbox immediately.
    if (isAdmin) {
      setPendingMessages([
        data.item,
        ...usePageStore.getState().pendingMessages,
      ]);
    }
  }

  // ---- Hero stats --------------------------------------------------------
  const heroStats: HeroStats[] = React.useMemo(() => {
    const currentYear = adminYears[adminYears.length - 1];
    const totalOfficerRecords = adminYears.reduce(
      (sum, y) => sum + y.officers.length,
      0,
    );
    return [
      { value: announcements.length, label: "Announcements" },
      { value: currentYear?.officers.length ?? 0, label: "Current Officers" },
      { value: totalOfficerRecords, label: "Officer Records" },
      { value: adminYears.length, label: "Years Tracked" },
    ];
  }, [announcements, adminYears]);

  // ---- Section routing ---------------------------------------------------
  function renderSection() {
    switch (activeNav) {
      case "Home":
        return (
          <>
            <HeroSection stats={heroStats} onNav={handleNav} />
            <RecentActivity announcements={announcements} onNav={handleNav} />
            <FeaturedOfficers adminYears={adminYears} onNav={handleNav} />
          </>
        );
      case "Announcements":
        return (
          <AnnouncementsSection
            announcements={announcements}
            isAdmin={isAdmin}
            onAdd={addAnnouncement}
            onUpdate={updateAnnouncement}
            onDelete={deleteAnnouncement}
            syncStatus={syncStatus}
          />
        );
      case "Officers":
        return <OfficersSection adminYears={adminYears} />;
      case "Contact":
        return <ContactSection onSubmit={submitContact} />;
      case "FAQ":
        return <FaqSection />;
      case "Admin Panel":
        return <AdminPanel />;
      case "Privacy Policy":
      case "Data Protection":
      case "Terms of Use":
      case "Cookie Policy": {
        const policy = getPolicyPage(activeNav);
        return policy ? (
          <PolicyPageSection policy={policy} />
        ) : (
          <HeroSection stats={heroStats} onNav={handleNav} />
        );
      }
      default:
        return <HeroSection stats={heroStats} onNav={handleNav} />;
    }
  }

  // ---- Loading gate ------------------------------------------------------
  if (!initialized) {
    return <PageLoader />;
  }

  // Reading progress is active on content-heavy pages, not on the hero.
  const showReadingProgress =
    activeNav === "Announcements" ||
    activeNav === "Officers" ||
    activeNav === "FAQ" ||
    activeNav === "Privacy Policy" ||
    activeNav === "Data Protection" ||
    activeNav === "Terms of Use" ||
    activeNav === "Cookie Policy";

  // ---- Render ------------------------------------------------------------
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <ReadingProgress active={showReadingProgress} />
      {/* Skip-to-content link for keyboard/screen-reader users (WCAG 2.4.1) */}
      <a
        href="#main-content"
        className="sr-only z-[70] rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:shadow-lg"
      >
        Skip to content
      </a>
      <SiteNav />
      <main id="main-content" className="flex-1" tabIndex={-1}>
        <SectionTransition sectionKey={activeNav}>
          {renderSection()}
        </SectionTransition>
      </main>
      <SiteFooter />
      <BackToTop />
      <CookieConsent />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={handleNav}
      />
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && resolveConfirm(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveConfirm(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={
                confirm?.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
              onClick={() => resolveConfirm(true)}
            >
              {confirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
