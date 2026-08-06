import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export type IntegrationKind = "webhook" | "outbound_api";

export type FieldType = "text" | "url" | "secret" | "channel";

export interface IntegrationField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  help?: string;

  maxLen: number;
}

export interface IntegrationDef {
  id: string;
  label: string;
  desc: string;
  icon: string;
  kind: IntegrationKind;

  fields: IntegrationField[];
}
export interface IntegrationStatus {
  id: string;
  label: string;
  desc: string;
  icon: string;
  kind: IntegrationKind;
  enabled: boolean;

  secretPreview: string | null;

  config: Record<string, string>;

  updatedAt: string | null;
}

const MAX_SECRET_LEN = 1024;
const MAX_FIELD_LEN = 500;

export const INTEGRATION_DEFS: IntegrationDef[] = [
  {
    id: "webhook",
    label: "REST API Webhook",
    desc: "Auto-publish announcements from external systems via a signed webhook.",
    icon: "Webhook",
    kind: "webhook",
    fields: [],
  },
  {
    id: "discord",
    label: "Discord Bot",
    desc: "Push announcements to a Discord server channel via a bot token.",
    icon: "MessageSquare",
    kind: "outbound_api",
    fields: [
      {
        name: "botToken",
        label: "Bot Token",
        type: "secret",
        required: true,
        placeholder: "MTk4NjIy...",
        help: "From the Discord Developer Portal > Bot > Reset Token.",
        maxLen: MAX_SECRET_LEN,
      },
      {
        name: "channelId",
        label: "Channel ID",
        type: "channel",
        required: true,
        placeholder: "123456789012345678",
        help: "Enable Developer Mode in Discord, right-click the channel > Copy ID.",
        maxLen: 64,
      },
    ],
  },
  {
    id: "google-workspace",
    label: "Google Workspace",
    desc: "Sync Google Calendar events as announcements.",
    icon: "Calendar",
    kind: "outbound_api",
    fields: [
      {
        name: "accessToken",
        label: "OAuth Access Token",
        type: "secret",
        required: true,
        placeholder: "ya29...",
        help: "Service-account or OAuth token with calendar.readonly scope.",
        maxLen: MAX_SECRET_LEN,
      },
      {
        name: "calendarId",
        label: "Calendar ID",
        type: "text",
        required: true,
        placeholder: "primary",
        help: "The calendar ID to read events from (often an email address).",
        maxLen: MAX_FIELD_LEN,
      },
    ],
  },
  {
    id: "facebook",
    label: "Facebook Page Feed",
    desc: "Auto-post announcements via the Meta Graph API.",
    icon: "Facebook",
    kind: "outbound_api",
    fields: [
      {
        name: "pageAccessToken",
        label: "Page Access Token",
        type: "secret",
        required: true,
        placeholder: "EAAG...",
        help: "Meta Graph API page token with pages_manage_posts permission.",
        maxLen: MAX_SECRET_LEN,
      },
      {
        name: "pageId",
        label: "Page ID",
        type: "text",
        required: true,
        placeholder: "1234567890",
        maxLen: 64,
      },
    ],
  },
  {
    id: "google-forms",
    label: "Google Forms",
    desc: "Receive member registration submissions as a webhook trigger.",
    icon: "ClipboardList",
    kind: "outbound_api",
    fields: [
      {
        name: "apiKey",
        label: "Apps Script Web App Token",
        type: "secret",
        required: true,
        placeholder: "token segment",
        help: "The query token appended to your Apps Script web app URL.",
        maxLen: MAX_SECRET_LEN,
      },
    ],
  },
];

const DEF_BY_ID = new Map(INTEGRATION_DEFS.map((d) => [d.id, d]));

export function getIntegrationDef(id: string): IntegrationDef | undefined {
  return DEF_BY_ID.get(id);
}

export const INTEGRATION_IDS = INTEGRATION_DEFS.map((d) => d.id);

export function serializeConfig(config: Record<string, string>): string {
  return JSON.stringify(config);
}

export function parseConfig(
  raw: string | null | undefined,
): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
export interface ConfigValidationResult {
  valid: boolean;
  error: string | null;

  config: Record<string, string>;
}

const CHANNEL_RE = /^\d{17,20}$/;
const DISCORD_TOKEN_RE = /^[A-Za-z0-9._-]{40,}$/;
const GENERIC_TOKEN_RE = /^[A-Za-z0-9._\-/+=]{8,}$/;

function validateField(
  field: IntegrationField,
  raw: unknown,
): { ok: boolean; error: string | null; value: string } {
  if (typeof raw !== "string") raw = "";
  let value = raw;
  if (field.type !== "secret") value = (raw as string).trim();

  if (field.required && !value) {
    return { ok: false, error: `${field.label} is required.`, value: "" };
  }
  if (value.length > field.maxLen) {
    return {
      ok: false,
      error: `${field.label} is too long (max ${field.maxLen} chars).`,
      value: "",
    };
  }
  // Optional + empty -> skip shape checks.
  if (!field.required && !value) return { ok: true, error: null, value: "" };

  if (field.type === "url") {
    try {
      const u = new URL(value);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return {
          ok: false,
          error: `${field.label} must use http or https.`,
          value: "",
        };
      }
    } catch {
      return {
        ok: false,
        error: `${field.label} is not a valid URL.`,
        value: "",
      };
    }
  } else if (field.type === "channel") {
    if (!CHANNEL_RE.test(value)) {
      return {
        ok: false,
        error: `${field.label} must be a 17-20 digit numeric ID.`,
        value: "",
      };
    }
  } else if (field.type === "secret") {
    if (field.name === "botToken" && !DISCORD_TOKEN_RE.test(value)) {
      return {
        ok: false,
        error: `${field.label} does not look like a Discord bot token.`,
        value: "",
      };
    }
    if (!GENERIC_TOKEN_RE.test(value)) {
      return {
        ok: false,
        error: `${field.label} contains invalid characters.`,
        value: "",
      };
    }
  }
  return { ok: true, error: null, value };
}

export function validateConfig(
  id: string,
  input: unknown,
): ConfigValidationResult {
  const def = getIntegrationDef(id);
  if (!def)
    return { valid: false, error: `Unknown integration: ${id}`, config: {} };

  if (input === undefined || input === null) {
    return { valid: false, error: "Config is required.", config: {} };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: "Config must be an object.", config: {} };
  }

  const src = input as Record<string, unknown>;
  const clean: Record<string, string> = {};
  // Secret-type fields are validated + stored separately (single `secret`
  // column per integration), so skip them here. The route checks required
  // secret presence against the `secret` value it receives.
  for (const field of def.fields) {
    if (field.type === "secret") continue;
    const r = validateField(field, src[field.name]);
    if (!r.ok) return { valid: false, error: r.error, config: {} };
    if (r.value) clean[field.name] = r.value;
  }
  return { valid: true, error: null, config: clean };
}

export function validateSecret(
  id: string,
  raw: unknown,
): { valid: boolean; error: string | null; normalized: string | null } {
  const def = getIntegrationDef(id);
  if (!def)
    return {
      valid: false,
      error: `Unknown integration: ${id}`,
      normalized: null,
    };
  const secretField = def.fields.find((f) => f.type === "secret");
  if (!secretField) {
    return {
      valid: false,
      error: "This integration has no admin-supplied secret.",
      normalized: null,
    };
  }
  if (
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "")
  ) {
    return { valid: true, error: null, normalized: null }; // keep existing
  }
  if (typeof raw !== "string") {
    return {
      valid: false,
      error: "Secret must be a string.",
      normalized: null,
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length > secretField.maxLen) {
    return {
      valid: false,
      error: `${secretField.label} is too long (max ${secretField.maxLen} chars).`,
      normalized: null,
    };
  }

  if (secretField.name === "botToken" && !DISCORD_TOKEN_RE.test(trimmed)) {
    return {
      valid: false,
      error: `${secretField.label} does not look like a Discord bot token.`,
      normalized: null,
    };
  }
  if (!GENERIC_TOKEN_RE.test(trimmed)) {
    return {
      valid: false,
      error: `${secretField.label} contains invalid characters.`,
      normalized: null,
    };
  }
  return { valid: true, error: null, normalized: trimmed };
}

export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 4) return "••••";
  return "…" + secret.slice(-4);
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

export const WEBHOOK_SIGNATURE_HEADER = "x-aoc-signature";
export const WEBHOOK_TIMESTAMP_HEADER = "x-aoc-timestamp";
export function signWebhook(
  body: string,
  timestamp: string,
  secret: string,
): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestamp}.${body}`);
  return hmac.digest("hex");
}
export function verifyWebhookSignature(
  body: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  if (!secret || !signature || !timestamp) return false;

  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = signWebhook(body, timestamp, secret);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

export function isWebhookTimestampFresh(
  timestamp: string,
  now: number = Date.now(),
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  // If the value looks like seconds (< 10^12), treat as seconds.
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const age = Math.abs(now - ms);
  return age <= WEBHOOK_MAX_AGE_MS;
}
export function toStatus(
  row: {
    id: string;
    enabled: boolean;
    config: string | null;
    secret: string | null;
    updatedAt: Date | string | null;
  },
  def?: IntegrationDef,
): IntegrationStatus {
  const d = def ?? getIntegrationDef(row.id);
  return {
    id: row.id,
    label: d?.label ?? row.id,
    desc: d?.desc ?? "",
    icon: d?.icon ?? "Plug",
    kind: d?.kind ?? "outbound_api",
    enabled: row.enabled,
    secretPreview: maskSecret(row.secret),
    config: parseConfig(row.config),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}
