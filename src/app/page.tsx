"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { PageLoader } from "@/components/page-loader";
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
import {
  AnnouncementPost,
  AnnouncementNotFound,
} from "@/components/sections/announcement-post";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AnalyticsBeacon } from "@/components/analytics-beacon";
import { ChatbotWidget } from "@/components/chatbot-widget";
import {
  parseAnnouncementHash,
  buildAnnouncementHash,
} from "@/lib/announcement-nav";
import type {
  Announcement,
  ContactMessage,
  HeroStats,
  SiteData,
  SectionKey,
} from "@/lib/types";

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
const InviteRedeemForm = dynamic(
  () =>
    import("@/components/admin/invite-redeem-form").then(
      (m) => m.InviteRedeemForm,
    ),
  { ssr: false },
);

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

  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  const [activeAnnouncementId, setActiveAnnouncementId] = React.useState<
    string | null
  >(null);
  const [confirmDeleteAnnouncement, setConfirmDeleteAnnouncement] =
    React.useState<Announcement | null>(null);
  const [inviteToken, setInviteToken] = React.useState<string | null>(null);

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
      if (
        data?.user &&
        (data.user.role === "admin" || data.user.role === "super_admin")
      ) {
        setIsAdmin(true);
        setAdminEmail(data.user.email);

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

  const { setTheme, theme } = useTheme();
  const toggleTheme = React.useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const handleNav = React.useCallback(
    (section: SectionKey) => {
      setActiveNav(section);
      setActiveAnnouncementId(null);
      if (typeof window !== "undefined") {
        if (window.location.hash) {
          history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
          );
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [setActiveNav],
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const id = parseAnnouncementHash(window.location.hash);
    if (id) {
      setActiveAnnouncementId(id);
      setActiveNav("Announcements");
    }
    function onHashChange() {
      const next = parseAnnouncementHash(window.location.hash);
      setActiveAnnouncementId(next);
      if (next) {
        setActiveNav("Announcements");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleOpenAnnouncement = React.useCallback((ann: Announcement) => {
    setActiveAnnouncementId(ann.id);
    if (typeof window !== "undefined") {
      const newHash = buildAnnouncementHash(ann.id);
      if (window.location.hash !== newHash) {
        history.pushState(null, "", newHash);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const handleCloseAnnouncement = React.useCallback(() => {
    setActiveAnnouncementId(null);
    if (typeof window !== "undefined" && window.location.hash) {
      history.pushState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (token && /^[0-9a-f]{8,}$/i.test(token)) {
      setInviteToken(token);
    }
  }, []);

  const handleInviteRedeemDone = React.useCallback(() => {
    setInviteToken(null);
    if (typeof window !== "undefined") {
      const url = window.location.pathname;
      window.history.replaceState(null, "", url);
    }
    setActiveNav("Admin Panel");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [setActiveNav]);

  useKeyboardShortcuts(handleNav, toggleTheme, () => setHelpOpen((o) => !o));
  useCommandPaletteShortcut(() => setPaletteOpen((o) => !o));

  async function addAnnouncement(
    ann: Omit<Announcement, "date"> & { date?: string },
  ) {
    setSyncStatus({ saving: true, error: null });
    const payload = {
      title: ann.title,
      body: ann.body,
      type: ann.type,
      image: ann.image,
      links: ann.links,
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
        links: ann.links,
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

  function deleteAnnouncement(id: string): Promise<boolean> {
    const ann = usePageStore.getState().announcements.find((a) => a.id === id);
    if (!ann) return Promise.resolve(false);
    setConfirmDeleteAnnouncement(ann);
    return new Promise<boolean>((resolve) => {
      deleteResolverRef.current = resolve;
    });
  }
  const deleteResolverRef = React.useRef<((ok: boolean) => void) | null>(null);

  async function handleConfirmDeleteAnnouncement() {
    const ann = confirmDeleteAnnouncement;
    if (!ann) return;
    setSyncStatus({ saving: true, error: null });
    const { error } = await api.delete(`/api/announcements/${ann.id}`);
    setSyncStatus({
      saving: false,
      error: error?.message ?? null,
      lastSavedAt: Date.now(),
    });
    if (error) {
      throw new Error(error.message);
    }
    setAnnouncements(
      usePageStore.getState().announcements.filter((a) => a.id !== ann.id),
    );
    if (activeAnnouncementId === ann.id) {
      handleCloseAnnouncement();
    }
    deleteResolverRef.current?.(true);
    deleteResolverRef.current = null;
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
    const { data, error } = await api.post<{ ok?: true }>(
      "/api/contact",
      message,
    );
    if (error || !data) {
      throw new Error(error?.message ?? "Failed to send message.");
    }
  }

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

  function renderSection() {
    if (activeAnnouncementId) {
      const ann = announcements.find((a) => a.id === activeAnnouncementId);
      if (!ann) {
        if (!syncStatus.ready) {
          return (
            <div className="mx-auto w-full max-w-3xl px-4 py-20 text-center text-sm text-muted-foreground">
              Loading announcement...
            </div>
          );
        }
        return <AnnouncementNotFound onBack={handleCloseAnnouncement} />;
      }
      const idx = announcements.findIndex((a) => a.id === activeAnnouncementId);
      return (
        <AnnouncementPost
          ann={ann}
          onBack={handleCloseAnnouncement}
          isAdmin={isAdmin}
          onEdit={(a) => {
            handleCloseAnnouncement();
            setTimeout(() => editRequestRef.current?.(a), 0);
          }}
          onDelete={(id) => {
            void deleteAnnouncement(id);
          }}
          onPrev={
            idx > 0
              ? () => handleOpenAnnouncement(announcements[idx - 1])
              : undefined
          }
          onNext={
            idx >= 0 && idx < announcements.length - 1
              ? () => handleOpenAnnouncement(announcements[idx + 1])
              : undefined
          }
          hasPrev={idx > 0}
          hasNext={idx >= 0 && idx < announcements.length - 1}
          position={idx >= 0 ? `${idx + 1} / ${announcements.length}` : null}
        />
      );
    }
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
            onOpen={handleOpenAnnouncement}
            syncStatus={syncStatus}
            editRequestRef={editRequestRef}
          />
        );
      case "Officers":
        return <OfficersSection adminYears={adminYears} />;
      case "Contact":
        return <ContactSection onSubmit={submitContact} isAdmin={isAdmin} />;
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
  const editRequestRef = React.useRef<((ann: Announcement) => void) | null>(
    null,
  );

  const showReadingProgress =
    activeAnnouncementId !== null ||
    activeNav === "Announcements" ||
    activeNav === "Officers" ||
    activeNav === "FAQ" ||
    activeNav === "Privacy Policy" ||
    activeNav === "Data Protection" ||
    activeNav === "Terms of Use" ||
    activeNav === "Cookie Policy";

  const appTree = !initialized ? (
    <PageLoader />
  ) : (
    <div className="flex min-h-screen flex-col bg-background">
      <ReadingProgress active={showReadingProgress} />
      <a
        href="#main-content"
        className="sr-only z-[70] rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:shadow-lg"
      >
        Skip to content
      </a>
      <SiteNav />
      <main id="main-content" className="flex-1" tabIndex={-1}>
        {inviteToken ? (
          <InviteRedeemForm
            token={inviteToken}
            onDone={handleInviteRedeemDone}
          />
        ) : (
          <SectionTransition sectionKey={activeAnnouncementId ?? activeNav}>
            {renderSection()}
          </SectionTransition>
        )}
      </main>
      <SiteFooter />
      <BackToTop />
      <CookieConsent />
      <ChatbotWidget />
      <AnalyticsBeacon
        section={activeAnnouncementId ? "Announcements" : activeNav}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={handleNav}
      />
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />

      <ConfirmDialog
        open={confirmDeleteAnnouncement !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmDeleteAnnouncement(null);
            deleteResolverRef.current?.(false);
            deleteResolverRef.current = null;
          }
        }}
        mode="destructive"
        title="Delete announcement"
        description={
          confirmDeleteAnnouncement
            ? `This permanently removes "${confirmDeleteAnnouncement.title}" and cannot be undone.`
            : ""
        }
        confirmLabel="Delete announcement"
        confirmToken={
          confirmDeleteAnnouncement
            ? confirmDeleteAnnouncement.title.slice(0, 60)
            : "DELETE"
        }
        confirmTokenHint="the announcement title"
        onConfirm={handleConfirmDeleteAnnouncement}
      />
    </div>
  );

  return appTree;
}
