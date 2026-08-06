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

export function isSmtpConfigured(): boolean {
  return getSmtpConfig() !== null;
}

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
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },

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

      bcc: cfg.fromEmail,
    };

    const info = await transporter.sendMail(mailOptions);
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    const rawMsg =
      error instanceof Error ? error.message : "Unknown SMTP error";
    logger.error("SMTP send failed", { error: rawMsg });
    return { ok: false, error: mapSmtpError(rawMsg) };
  }
}

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
  return "Failed to send email. Check the server logs for details.";
}

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
    const rawMsg =
      error instanceof Error ? error.message : "Unknown SMTP error";
    logger.error("SMTP test email failed", { error: rawMsg, to });
    return { ok: false, error: mapSmtpError(rawMsg) };
  }
}

export function _resetTransporterForTesting(): void {
  _transporter = null;
}
