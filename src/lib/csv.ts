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

export function buildCsv(header: string[], rows: string[][]): string {
  const headerLine = header.join(",");
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  return body ? `${headerLine}\n${body}` : headerLine;
}
