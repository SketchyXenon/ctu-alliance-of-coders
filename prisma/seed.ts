// Seed the database with initial Alliance of Coders data.
// Run with: bun run db:seed (or prisma db seed)
// Idempotent: safe to run multiple times.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const ANNOUNCEMENTS = [
  {
    id: "ann-001",
    type: "award",
    title: "Best IT Organization - Regional Tech Summit 2024",
    body: "Alliance of Coders clinched the Best IT Organization award at the Regional Tech Summit held in Cebu City. The award recognized our hackathon programs, community outreach, and consistent delivery of tech education to underserved communities.",
    date: "2024-11-15",
    pinned: true,
  },
  {
    id: "ann-002",
    type: "recognition",
    title: "National Coding Competition - 2nd Place Nationwide",
    body: "Our delegates ranked 2nd nationwide in the DICT National Coding Competition, competing against 87 other universities across Luzon, Visayas, and Mindanao. Congratulations to our team!",
    date: "2024-09-03",
    pinned: true,
  },
  {
    id: "ann-003",
    type: "report",
    title: "Devfest CTU Danao 2024 - Accomplishment Report",
    body: "Devfest 2024 concluded with 320 registered participants, 12 workshops, 5 live coding challenges, and 3 keynote speakers from the industry. Full report is available in the organization drive.",
    date: "2024-08-20",
    pinned: false,
  },
  {
    id: "ann-004",
    type: "general",
    title: "General Assembly - SY 2025-2026 Membership Enrollment Open",
    body: "New and returning members may now register for AY 2025-2026 membership. Slots are limited to 120 members. Fill out the Google Form linked on our official Facebook page before July 31.",
    date: "2025-06-01",
    pinned: false,
  },
  {
    id: "ann-005",
    type: "recognition",
    title: "CTU System-Wide Tech Fair - Best Booth Award",
    body: "Our interactive demo booth on AI-powered tools won Best Booth at the CTU System-Wide Tech Fair 2024. Thank you to every member who contributed to the preparation and presentation.",
    date: "2024-07-12",
    pinned: false,
  },
  {
    id: "ann-006",
    type: "report",
    title: "Semester Accomplishment Report - 2nd Sem AY 2023-2024",
    body: "We successfully conducted 6 technical workshops, 2 inter-school competitions, 1 community outreach program, and 4 general assemblies during the second semester. Full report attached.",
    date: "2024-06-05",
    pinned: false,
  },
];

const ADMIN_YEARS = [
  {
    year: "2024-2025",
    theme: "Innovate. Elevate. Collaborate.",
    officers: [
      { name: "Maria Santos", role: "President" },
      { name: "Juan Dela Cruz", role: "Vice President" },
      { name: "Ana Reyes", role: "Secretary" },
      { name: "Carlo Mendoza", role: "Treasurer" },
      { name: "Liza Bautista", role: "PRO" },
      { name: "Mark Torres", role: "Technical Head" },
      { name: "Grace Villanueva", role: "Events Head" },
      { name: "Rico Fernandez", role: "Auditor" },
    ],
  },
  {
    year: "2023-2024",
    theme: "Code the Future.",
    officers: [
      { name: "Jerome Abad", role: "President" },
      { name: "Sheila Ramos", role: "Vice President" },
      { name: "Kenneth Lim", role: "Secretary" },
      { name: "Patricia Gomez", role: "Treasurer" },
      { name: "Ryan Castro", role: "PRO" },
      { name: "Ivy Ong", role: "Technical Head" },
    ],
  },
  {
    year: "2022-2023",
    theme: "Empower Through Code.",
    officers: [
      { name: "Leo Navarro", role: "President" },
      { name: "Mia Aquino", role: "Vice President" },
      { name: "Ben Soriano", role: "Secretary" },
      { name: "Cora Macaraeg", role: "Treasurer" },
      { name: "Dan Villarin", role: "PRO" },
    ],
  },
];

async function main() {
  // Announcements
  for (const ann of ANNOUNCEMENTS) {
    await db.announcement.upsert({
      where: { id: ann.id },
      update: {},
      create: { ...ann, image: null },
    });
  }

  // Admin years + officers. sortOrder ascends with recency: the latest year
  // has the highest sortOrder so "sort ascending, pick last" = latest year.
  for (let i = 0; i < ADMIN_YEARS.length; i++) {
    const y = ADMIN_YEARS[i];
    const sortOrder = ADMIN_YEARS.length - 1 - i;
    const year = await db.adminYear.upsert({
      where: { year: y.year },
      update: { theme: y.theme, sortOrder },
      create: { year: y.year, theme: y.theme, sortOrder },
    });
    // Reset officers for this year to match seed.
    await db.officer.deleteMany({ where: { yearId: year.id } });
    for (let j = 0; j < y.officers.length; j++) {
      const o = y.officers[j];
      await db.officer.create({
        data: {
          name: o.name,
          role: o.role,
          image: null,
          sortOrder: j,
          yearId: year.id,
        },
      });
    }
  }

  // No demo admin account in seed. Use `bun run bootstrap` to create the
  // first admin interactively (see scripts/bootstrap-admin.ts).

  console.info("Seed complete.");
  console.info("No admin account created. Run `bun run bootstrap` to create one.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
