import nodemailer, { type Transporter } from "nodemailer";

/**
 * Sends transactional email (account invites, MFA lost-device recovery
 * links) via AWS SES's SMTP interface.
 *
 * Deliberately SMTP, not the AWS SDK's SES API — SES offers both, and they
 * need DIFFERENT credentials: the API wants a plain IAM access key/secret,
 * while SMTP wants the "SMTP credentials" SES generates for you (an IAM
 * access-key-shaped username plus a one-way-derived password that only
 * works for SMTP AUTH, not for signing API calls). This app was pointed at
 * SMTP credentials, so it authenticates the same way.
 *
 * SES_SMTP_USERNAME / SES_SMTP_PASSWORD come from the SES console → SMTP
 * Settings → "Create SMTP credentials" (this also creates a small IAM user
 * behind the scenes just for this). SES_REGION picks which regional SMTP
 * endpoint to talk to (email-smtp.<region>.amazonaws.com) — it must be the
 * same region you generated the SMTP credentials in. SES_FROM_EMAIL must
 * be a verified sender identity (or domain) in that same SES region.
 *
 * DEV FALLBACK: if SES_SMTP_USERNAME/SES_SMTP_PASSWORD/SES_FROM_EMAIL
 * aren't all set, emails are logged to the console instead of sent — lets
 * you develop and test the invite/recovery flows end-to-end (the link is
 * right there in the log) before wiring up real SES credentials.
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const region = process.env.SES_REGION || "us-east-1";
  const port = Number(process.env.SES_SMTP_PORT ?? 587);
  transporter = nodemailer.createTransport({
    host: `email-smtp.${region}.amazonaws.com`,
    port,
    // Port 587 (the default, and AWS's recommended one) is STARTTLS: the
    // connection starts in plaintext and upgrades to TLS before AUTH —
    // secure:false + requireTLS:true is nodemailer's way of saying that.
    // Port 465 would instead be secure:true (TLS from the start).
    secure: port === 465,
    requireTLS: port !== 465,
    auth: {
      user: process.env.SES_SMTP_USERNAME,
      pass: process.env.SES_SMTP_PASSWORD,
    },
  });
  return transporter;
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SES_SMTP_USERNAME && process.env.SES_SMTP_PASSWORD && process.env.SES_FROM_EMAIL);
}

export async function sendEmail(params: { to: string; subject: string; html: string; text: string }): Promise<void> {
  if (!smtpConfigured()) {
    console.log(
      `[email] SES SMTP not fully configured (need SES_SMTP_USERNAME, SES_SMTP_PASSWORD, SES_FROM_EMAIL) ` +
        `— logging instead of sending.\n` +
        `  To: ${params.to}\n  Subject: ${params.subject}\n  ---\n${params.text}\n  ---`
    );
    return;
  }

  await getTransporter().sendMail({
    from: process.env.SES_FROM_EMAIL,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
}

/** Base URL used to build links in emails (invite, MFA recovery). */
export function appBaseUrl(): string {
  const raw = process.env.APP_BASE_URL;
  if (!raw) {
    throw new Error("APP_BASE_URL is not set — needed to build links in emails. Set it in your environment.");
  }
  return raw.replace(/\/+$/, "");
}
