// Server-only email service for replying to contact messages via SMTP.
// Uses nodemailer with Gmail / Google Workspace SMTP (configurable via env).
// Per 06-security-architecture.md section 8: SMTP credentials stay server-side,
// never shipped to the client. Per 03 section 6: fail fast with clear messages.
// Per 02 section 6: timeouts on every external call, graceful degradation.
//
// Required env vars (all optional at boot, checked at send time):
//   SMTP_HOST       - e.g. smtp.gmail.com
//   SMTP_PORT       - e.g. 587 (STARTTLS) or 465 (TLS)
//   SMTP_USER       - the Gmail/Workspace address
//   SMTP_PASS       - Google App Password (NOT the account password)
//   SMTP_FROM_NAME  - display name for the From header (e.g. "Alliance of Coders")
//   SMTP_FROM_EMAIL - From address (usually same as SMTP_USER; must be the Gmail account)
//
// Google deprecated "less secure apps" in 2022. You MUST use a Google App
// Password (generate at myaccount.google.com > Security > 2-Step Verification >
// App passwords). Regular account passwords will not work.

import type { Transporter } from "nodemailer";
import { logger } from "./logger";

let _transporter: Transporter | null = null;

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

/**
 * Read and validate SMTP config from env. Returns null if not configured.
 * Per 03 section 6: fail fast — callers get a clear null to check, not a
 * half-configured transport that fails mid-send.
 */
export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const fromName = process.env.SMTP_FROM_NAME || "Alliance of Coders";
  const fromEmail = process.env.SMTP_FROM_EMAIL || user || "";

  if (!host || !port || !user || !pass) {
    return null;
  }

  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return null;
  }

  return { host, port: portNum, user, pass, fromName, fromEmail };
}

/** True if SMTP is fully configured. Used by the status endpoint + UI. */
export function isSmtpConfigured(): boolean {
  return getSmtpConfig() !== null;
}

/**
 * Lazily create the nodemailer transporter. Singleton so we reuse the
 * connection pool across requests. Per 02 section 5: stateless services —
 * but a transporter is a connection pool, not request state, so reusing it
 * is correct and more efficient than creating per-request.
 */
async function getTransporter(): Promise<Transporter> {
  if (_transporter) return _transporter;

  const cfg = getSmtpConfig();
  if (!cfg) {
    throw new Error(
      "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env.",
    );
  }

  const nodemailer = await import("nodemailer");
  _transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465, // true for 465, false for 587 (STARTTLS)
    auth: { user: cfg.user, pass: cfg.pass },
    // Per 02 section 6: timeouts on every external call.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return _transporter;
}

export interface ReplyEmailParams {
  to: string;
  toName: string;
  subject: string;
  body: string;
  originalMessage: string;
  originalSubject: string;
  originalDate: string;
  adminEmail: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a reply email to a contact-message submitter. Builds a plain-text
 * email with the reply body + quoted original message (standard email
// convention). Per 06 section 7: caller is responsible for rate-limiting.
 * Per 06 section 11: caller is responsible for audit logging.
 *
 * Trade-off (per 02 section 9): we send plain text, not HTML, to avoid
 * XSS via email clients that render HTML. Plain text is universally
 * deliverable and cannot carry script. The cost is no rich formatting.
 */
export async function sendReplyEmail(
  params: ReplyEmailParams,
): Promise<SendEmailResult> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    return {
      ok: false,
      error:
        "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL in .env.",
    };
  }

  try {
    const transporter = await getTransporter();

    // Build the email body: admin's reply + quoted original message.
    const quotedOriginal = params.originalMessage
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

    const text = [
      params.body,
      "",
      "--",
      `On ${params.originalDate}, ${params.toName} wrote:`,
      `Subject: ${params.originalSubject}`,
      "",
      quotedOriginal,
      "",
      `--`,
      `This reply was sent by ${cfg.fromName} via the Alliance of Coders admin panel.`,
      `If you did not expect this email, you can safely ignore it.`,
    ].join("\n");

    const mailOptions = {
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to: params.toName ? `"${params.toName}" <${params.to}>` : params.to,
      replyTo: cfg.fromEmail,
      subject: params.subject,
      text,
      // BCC the admin so there's a record in the admin's sent folder.
      bcc: cfg.fromEmail,
    };

    const info = await transporter.sendMail(mailOptions);
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    // Per A10-1 fix: never surface raw nodemailer error messages to the
    // client — they may include internal hostnames, ports, or stack traces.
    // Log the full error server-side; return a mapped user-friendly message.
    const rawMsg =
      error instanceof Error ? error.message : "Unknown SMTP error";
    logger.error("SMTP send failed", { error: rawMsg });
    return { ok: false, error: mapSmtpError(rawMsg) };
  }
}

/**
 * Map raw nodemailer/SMTP error messages to user-friendly strings.
 * Per 06 A10: "Error responses reveal what the user needs, not stack traces
 * or internal state." The admin sees a friendly message; the full error is
 * logged server-side for diagnosis.
 */
function mapSmtpError(msg: string): string {
  const lower = msg.toLowerCase();
  if (
    /auth|authentication|535|username and password|invalid login/i.test(lower)
  ) {
    return "SMTP authentication failed. Check SMTP_USER and SMTP_PASS (use a Google App Password, not your account password).";
  }
  if (
    /connect|econnrefused|econnreset|etimedout|enotfound|can't reach/i.test(
      lower,
    )
  ) {
    return "Could not connect to the SMTP server. Check SMTP_HOST and SMTP_PORT, and verify your network allows outbound SMTP.";
  }
  if (/recipient|address rejected|550|551|553/i.test(lower)) {
    return "The recipient email address was rejected by the SMTP server.";
  }
  if (/quota|limit|421|450|451|452/i.test(lower)) {
    return "The SMTP server temporarily rejected the email (rate limit or quota). Please try again later.";
  }
  if (/ssl|tls|cert|self-signed/i.test(lower)) {
    return "SMTP TLS/SSL error. Check SMTP_PORT (587 for STARTTLS, 465 for TLS) and the server's certificate.";
  }
  // Generic fallback — no internal details leaked.
  return "Failed to send email. Check the server logs for details.";
}

/**
 * Send a test email to verify SMTP connectivity. Used by the integrations
 * panel's "Send test email" button. Per 02 section 6: verify the connection
 * works before relying on it.
 */
export async function sendTestEmail(to: string): Promise<SendEmailResult> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    return {
      ok: false,
      error: "SMTP is not configured.",
    };
  }

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to,
      subject: "Alliance of Coders — SMTP test email",
      text: [
        "This is a test email from the Alliance of Coders admin panel.",
        "",
        `Sent at: ${new Date().toISOString()}`,
        `From: ${cfg.fromName} <${cfg.fromEmail}>`,
        `SMTP host: ${cfg.host}:${cfg.port}`,
        "",
        "If you received this email, your SMTP configuration is working correctly.",
      ].join("\n"),
    });
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    // Per A10-1 fix: map to user-friendly message; log full error server-side.
    const rawMsg =
      error instanceof Error ? error.message : "Unknown SMTP error";
    logger.error("SMTP test email failed", { error: rawMsg, to });
    return { ok: false, error: mapSmtpError(rawMsg) };
  }
}

/** Reset the transporter singleton. Used in tests. */
export function _resetTransporterForTesting(): void {
  _transporter = null;
}
