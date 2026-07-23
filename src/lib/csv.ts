// Shared CSV helpers (Q6: csvEscape was duplicated across export routes).
// Per 03-software-engineering.md DRY: abstract on the third occurrence.

/** Escape a string for safe inclusion in a CSV field.
 *  Neutralizes CSV formula injection (CWE-1236) by prefixing any leading
 *  = + - @ TAB CR with a single quote, so spreadsheet apps treat the cell
 *  as text rather than evaluating it as a formula. Per 06-security-architecture
 *  A05 (Injection). */
export function csvEscape(value: string): string {
  let escaped = value;
  if (/^[=+\-@\t\r]/.test(escaped)) {
    escaped = "'" + escaped;
  }
  if (/[",\n\r]/.test(escaped)) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

/** Build a CSV document from a header row and data rows.
 *  Each cell is run through csvEscape so callers cannot forget to neutralize
 *  formula injection (CWE-1236) — defense in depth per 06-security-architecture
 *  A05. Headers are trusted constants and are NOT escaped. */
export function buildCsv(header: string[], rows: string[][]): string {
  const headerLine = header.join(",");
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  return body ? `${headerLine}\n${body}` : headerLine;
}
