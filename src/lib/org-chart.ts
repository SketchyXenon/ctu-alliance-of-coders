import type { Officer } from "./types";

/**
 * Detect whether setting `newReportsToId` on `officerId` would create a
 * cycle in the reporting chain. A cycle = following reportsToId from the
 * proposed parent eventually leads back to `officerId`.
 *
 * @param officerId  the officer being updated
 * @param newReportsToId  the proposed parent (may be null = root, always safe)
 * @param officers  all officers in the SAME year (cross-year parents are
 *                  rejected separately by the API)
 * @returns true if assigning newReportsToId would create a cycle
 */
export function wouldCreateCycle(
  officerId: string,
  newReportsToId: string | null,
  officers: Pick<Officer, "id" | "reportsToId">[],
): boolean {
  if (!newReportsToId) return false;
  if (newReportsToId === officerId) return true;

  const byId = new Map(officers.map((o) => [o.id, o.reportsToId ?? null]));
  let cursor: string | null = newReportsToId;
  const seen = new Set<string>();
  for (let i = 0; i < officers.length + 1; i++) {
    if (cursor === null) return false;
    if (cursor === officerId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = byId.get(cursor) ?? null;
  }
  return false;
}
export interface OfficerNode {
  officer: Officer;
  children: OfficerNode[];
}

const ROLE_PRIORITY: Array<{ match: RegExp; priority: number }> = [
  { match: /^president$/i, priority: 0 },
  { match: /vice[\s-]*president/i, priority: 10 },
  { match: /^secretary$/i, priority: 20 },
  { match: /^treasurer$/i, priority: 30 },
  { match: /^auditor/i, priority: 40 },
  { match: /public\s*information/i, priority: 50 },
  { match: /representative|^rep\.?$/i, priority: 80 },
  { match: /member/i, priority: 90 },
];
const DEFAULT_PRIORITY = 60;

export function getRolePriority(role: string): number {
  const r = (role ?? "").trim();
  if (!r) return DEFAULT_PRIORITY;
  for (const entry of ROLE_PRIORITY) {
    if (entry.match.test(r)) return entry.priority;
  }
  return DEFAULT_PRIORITY;
}

export function sortOfficersByRolePriority(list: Officer[]): Officer[] {
  return list.slice().sort(compareOfficers);
}

function compareOfficers(a: Officer, b: Officer): number {
  const pa = getRolePriority(a.role);
  const pb = getRolePriority(b.role);
  if (pa !== pb) return pa - pb;
  const sa = a.sortOrder ?? 0;
  const sb = b.sortOrder ?? 0;
  if (sa !== sb) return sa - sb;
  return (a.name ?? "").localeCompare(b.name ?? "");
}

export function buildOrgTree(officers: Officer[]): OfficerNode[] | null {
  if (officers.length === 0) return null;

  const hasAnyReportsTo = officers.some((o) => o.reportsToId);
  if (!hasAnyReportsTo) return null; // fall back to legacy two-level tree

  const byId = new Map(officers.map((o) => [o.id, o]));
  // Roots: reportsToId null/undefined, OR points to an id not in this year's set.
  const roots = officers.filter(
    (o) => !o.reportsToId || !byId.has(o.reportsToId),
  );
  const childrenOf = (parentId: string): Officer[] =>
    officers.filter((o) => o.reportsToId === parentId);

  function buildNode(officer: Officer): OfficerNode {
    const kids = childrenOf(officer.id).slice().sort(compareOfficers);
    return { officer, children: kids.map(buildNode) };
  }

  return roots.slice().sort(compareOfficers).map(buildNode);
}

export function flattenOrgTree(
  nodes: OfficerNode[],
  depth = 0,
): { officer: Officer; depth: number }[] {
  const out: { officer: Officer; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ officer: n.officer, depth });
    out.push(...flattenOrgTree(n.children, depth + 1));
  }
  return out;
}
