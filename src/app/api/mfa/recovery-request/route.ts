import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateToken } from "@/lib/tokens";
import { sendEmail, appBaseUrl } from "@/lib/email";
import { logAudit } from "@/lib/audit";

const RESET_TTL_MINUTES = 30;

// Always the same generic response, whether or not the email matched an
// account — otherwise this endpoint would let anyone check which emails
// have accounts here (and which have MFA enabled) just by watching the
// response change.
const GENERIC_RESPONSE = {
  ok: true,
  message: "If that email has an account with MFA enabled, we've sent a reset link to it.",
};

/**
 * "Lost your device?" — request an emailed link to redo MFA setup from
 * scratch. Does NOT log the user in; see /api/mfa/recovery/[token] for what
 * the link actually does.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.status === "ACTIVE" && user.mfaEnabled) {
    const { raw, hash } = generateToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaResetTokenHash: hash, mfaResetExpiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000) },
    });

    const link = `${appBaseUrl()}/mfa/recovery/${raw}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your Query Monitor MFA device",
      text:
        `Hi ${user.name},\n\n` +
        `Someone (hopefully you) asked to reset multi-factor authentication on your Query Monitor account ` +
        `because the device it's set up on was lost.\n\n` +
        `This link lets you set up a new authenticator app. It does not log you in by itself — ` +
        `you'll still need your password afterward.\n\n${link}\n\n` +
        `This link expires in ${RESET_TTL_MINUTES} minutes. If you didn't request this, you can ignore ` +
        `this email — your account is unaffected.`,
      html:
        `<p>Hi ${user.name},</p>` +
        `<p>Someone (hopefully you) asked to reset multi-factor authentication on your Query Monitor account ` +
        `because the device it's set up on was lost.</p>` +
        `<p>This link lets you set up a new authenticator app. It does <strong>not</strong> log you in by itself — ` +
        `you'll still need your password afterward.</p>` +
        `<p><a href="${link}">${link}</a></p>` +
        `<p>This link expires in ${RESET_TTL_MINUTES} minutes. If you didn't request this, you can ignore this ` +
        `email — your account is unaffected.</p>`,
    });

    await logAudit({ actorEmail: user.email, actorId: user.id, action: "MFA_RESET_REQUESTED" });
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
