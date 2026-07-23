"use client";

import * as React from "react";
import {
  Activity,
  AlertCircle,
  Calendar,
  Download,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  RefreshCw,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { SectionHeading } from "@/components/section-heading";
import { GearLogo } from "@/components/gear-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { usePageStore } from "@/lib/store";
import type { AdminUserPublic, ContactMessage, AdminYear } from "@/lib/types";

const STAT_ICONS: Record<string, LucideIcon> = {
  Megaphone,
  Users,
  Calendar,
  Mail,
};

import { LoginForm } from "@/components/admin/login-form";
import { InboxPanel } from "@/components/admin/inbox-panel";
import { OfficersManager } from "@/components/admin/officers-manager";
import { IntegrationsPanel } from "@/components/admin/integrations-panel";
import { ActivityPanel } from "@/components/admin/activity-panel";
import { SettingsDialog } from "@/components/admin/settings-dialog";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "forbidden"; user: AdminUserPublic }
  | { status: "admin"; user: AdminUserPublic };

/**
 * AdminPanel - orchestrates the admin console.
 *
 * On mount we check the session. The three valid branches are:
 *   - anonymous  -> LoginForm
 *   - forbidden  -> access-restricted card (signed in but not an admin)
 *   - admin      -> dashboard with Tabs (Inbox / Officers / Integrations)
 *
 * Children receive store data + a refresh callback. They call the API and
 * trigger refresh themselves; the store stays the single source of truth.
 */
export function AdminPanel() {
  const isAdmin = usePageStore((s) => s.isAdmin);
  const adminEmail = usePageStore((s) => s.adminEmail);
  const setIsAdmin = usePageStore((s) => s.setIsAdmin);
  const setAdminEmail = usePageStore((s) => s.setAdminEmail);
  const pendingMessages = usePageStore((s) => s.pendingMessages);
  const setPendingMessages = usePageStore((s) => s.setPendingMessages);
  const adminYears = usePageStore((s) => s.adminYears);
  const announcements = usePageStore((s) => s.announcements);
  const setAdminYears = usePageStore((s) => s.setAdminYears);

  // `checked` flips true after the first session probe completes. Until then
  // we show a loading state. The derived `auth` value reacts to the store so
  // LoginForm's setIsAdmin(true) immediately promotes us to the dashboard.
  const [checked, setChecked] = React.useState(false);
  const [forbiddenUser, setForbiddenUser] = React.useState<AdminUserPublic | null>(null);
  const [signingOut, setSigningOut] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function check() {
      const { data } = await api.get<{ user: AdminUserPublic | null }>(
        "/api/auth/session"
      );
      if (cancelled) return;
      if (data?.user) {
        if (data.user.role !== "admin") {
          setForbiddenUser(data.user);
          setIsAdmin(false);
          setAdminEmail(data.user.email);
        } else {
          setIsAdmin(true);
          setAdminEmail(data.user.email);
        }
      }
      setChecked(true);
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  const auth: AuthState = isAdmin
    ? {
        status: "admin",
        user: {
          id: "session",
          email: adminEmail ?? "",
          name: null,
          role: "admin",
        },
      }
    : forbiddenUser
      ? { status: "forbidden", user: forbiddenUser }
      : checked
        ? { status: "anonymous" }
        : { status: "loading" };

  async function handleSignOut() {
    setSigningOut(true);
    const { error } = await api.post("/api/auth/logout");
    setSigningOut(false);
    if (error) {
      toast.error("Sign out failed", { description: error.message });
      return;
    }
    setIsAdmin(false);
    setAdminEmail(null);
    setForbiddenUser(null);
    toast.success("Signed out");
  }

  // ---- Refresh helpers (children call these to re-sync the store) ---------

  const refreshMessages = React.useCallback(async () => {
    const { data, error } = await api.get<{ items: ContactMessage[] }>(
      "/api/contact"
    );
    if (error || !data) return;
    setPendingMessages(data.items);
  }, [setPendingMessages]);

  const refreshYears = React.useCallback(async () => {
    const { data, error } = await api.get<{ items: AdminYear[] }>(
      "/api/admin-years"
    );
    if (error || !data) return;
    setAdminYears(data.items);
  }, [setAdminYears]);

  // ---- Loading state -------------------------------------------------------

  if (auth.status === "loading") {
    return (
      <div
        className="flex min-h-[60vh] items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative h-12 w-12" aria-hidden="true">
            <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-500 animate-ping" />
            <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-gold-400 animate-[spin_1.4s_linear_infinite] [transform-origin:center_24px]" />
          </div>
          <p className="text-sm text-muted-foreground">Verifying session...</p>
        </div>
      </div>
    );
  }

  // ---- Anonymous -----------------------------------------------------------

  if (auth.status === "anonymous") {
    return <LoginForm />;
  }

  // ---- Signed in but not an admin -----------------------------------------

  if (auth.status === "forbidden") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md border-border/60 shadow-lg">
          <CardHeader className="items-center gap-3 text-center">
            <GearLogo size={48} />
            <div className="space-y-1">
              <CardTitle className="font-display text-2xl">
                Access Restricted
              </CardTitle>
              <CardDescription>
                You are signed in, but this account does not have admin
                privileges.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <ShieldCheck aria-hidden="true" />
              <AlertTitle>Signed in as</AlertTitle>
              <AlertDescription>{auth.user.email}</AlertDescription>
            </Alert>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              <LogOut className="size-4" aria-hidden="true" />
              {signingOut ? "Signing out..." : "Sign Out"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Admin dashboard ----------------------------------------------------

  const user = auth.user;
  const initials = (user.email ?? "")
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <SectionHeading
          eyebrow="Administration"
          title="Admin Panel"
          sub="Manage announcements, officers, and messages."
          icon="LayoutDashboard"
          iconLabel="Admin"
        />
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 p-2 pl-3">
          <Avatar className="size-8 border border-border/60">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="hidden flex-col leading-tight sm:flex">
            <span className="text-xs font-medium text-foreground">
              {adminEmail ?? user.email}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Administrator
            </span>
          </div>
          <Badge
            variant="outline"
            className="ml-1 hidden border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300 md:inline-flex"
          >
            <ShieldCheck className="size-3" aria-hidden="true" />
            Admin
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open settings"
          >
            <Settings className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Settings</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            disabled={signingOut}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Sign out of admin panel"
          >
            <LogOut className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {signingOut ? "..." : "Sign Out"}
            </span>
          </Button>
        </div>
      </div>

      {/* Quick actions row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.open("/api/announcements/export", "_blank");
          }}
          className="gap-1.5"
        >
          <Download className="size-3.5" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {/* Stats overview */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <AdminStatCard
          label="Announcements"
          value={announcements.length}
          icon="Megaphone"
          accent="gold"
        />
        <AdminStatCard
          label="Officer Records"
          value={adminYears.reduce((s, y) => s + y.officers.length, 0)}
          icon="Users"
          accent="navy"
        />
        <AdminStatCard
          label="Years Tracked"
          value={adminYears.length}
          icon="Calendar"
          accent="navy"
        />
        <AdminStatCard
          label="New Messages"
          value={pendingMessages.filter((m) => m.status === "new").length}
          icon="Mail"
          accent={pendingMessages.some((m) => m.status === "new") ? "gold" : "navy"}
        />
      </div>

      <Tabs defaultValue="inbox" className="w-full">
        <div className="flex items-center justify-between gap-2">
          <TabsList className="bg-muted/60">
            <TabsTrigger value="inbox">
              <AlertCircle className="size-3.5" aria-hidden="true" />
              Inbox
              {pendingMessages.filter((m) => m.status === "new").length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 h-4 px-1 text-[10px] leading-none"
                >
                  {pendingMessages.filter((m) => m.status === "new").length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="officers">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Officers
            </TabsTrigger>
            <TabsTrigger value="integrations">
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Integrations
            </TabsTrigger>
            <TabsTrigger value="activity">
              <Activity className="size-3.5" aria-hidden="true" />
              Activity
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="inbox" className="mt-4">
          <InboxPanel
            messages={pendingMessages}
            onRefresh={refreshMessages}
          />
        </TabsContent>
        <TabsContent value="officers" className="mt-4">
          <OfficersManager
            adminYears={adminYears}
            onRefresh={refreshYears}
          />
        </TabsContent>
        <TabsContent value="integrations" className="mt-4">
          <IntegrationsPanel />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityPanel />
        </TabsContent>
      </Tabs>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

/**
 * AdminStatCard - compact metric card for the dashboard overview row.
 * Shows an icon + big number + label, with gold or navy accent.
 */
function AdminStatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: string;
  accent: "gold" | "navy";
}) {
  const Icon = STAT_ICONS[icon] ?? LayoutDashboard;
  return (
    <Card className="card-lift overflow-hidden border-border/60 shadow-sm hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg " +
            (accent === "gold"
              ? "bg-gold-500/15 text-gold-600 dark:text-gold-400"
              : "bg-primary/10 text-primary")
          }
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="font-display text-2xl font-bold tabular-nums text-foreground">
            {value}
          </div>
          <div className="truncate text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
