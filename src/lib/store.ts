"use client";

import { create } from "zustand";
import type {
  Announcement,
  AdminYear,
  ContactMessage,
  SectionKey,
  SyncStatus,
} from "@/lib/types";

interface PageState {
  activeNav: SectionKey;
  setActiveNav: (section: SectionKey) => void;

  announcements: Announcement[];
  setAnnouncements: (items: Announcement[]) => void;

  adminYears: AdminYear[];
  setAdminYears: (items: AdminYear[]) => void;

  pendingMessages: ContactMessage[];
  setPendingMessages: (items: ContactMessage[]) => void;
  addPendingMessage: (item: ContactMessage) => void;

  isAdmin: boolean;
  setIsAdmin: (v: boolean) => void;

  adminEmail: string | null;
  setAdminEmail: (v: string | null) => void;

  syncStatus: SyncStatus;
  setSyncStatus: (patch: Partial<SyncStatus>) => void;

  initialized: boolean;
  setInitialized: (v: boolean) => void;
}

export const usePageStore = create<PageState>((set) => ({
  activeNav: "Home",
  setActiveNav: (section) => set({ activeNav: section }),

  announcements: [],
  setAnnouncements: (items) => set({ announcements: items }),

  adminYears: [],
  setAdminYears: (items) => set({ adminYears: items }),

  pendingMessages: [],
  setPendingMessages: (items) => set({ pendingMessages: items }),
  addPendingMessage: (item) =>
    set((s) => ({ pendingMessages: [item, ...s.pendingMessages] })),

  isAdmin: false,
  setIsAdmin: (v) => set({ isAdmin: v }),

  adminEmail: null,
  setAdminEmail: (v) => set({ adminEmail: v }),

  syncStatus: { ready: false, saving: false, error: null, lastSavedAt: null },
  setSyncStatus: (patch) =>
    set((s) => ({ syncStatus: { ...s.syncStatus, ...patch } })),

  initialized: false,
  setInitialized: (v) => set({ initialized: v }),
}));
