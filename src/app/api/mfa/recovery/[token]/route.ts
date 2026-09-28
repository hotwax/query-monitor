import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashToken, tokensMatch } from "@/lib/tokens";
import { beginMfaSetup, confirmMfaSetup } from "@/lib/mfa";
import { logAudit } from "@/lib/audit";

async function resolveUser(token: string) {
  const hash = hashToken(token);
  const user = await prisma.user.findFirst({ where: { mfaResetTokenHash: hash } });
  if (!user || !tokensMatch(user.mfaResetTokenHash, hash)) return null;
  if (!user.mfaResetExpiresAt || user.mfaResetExpiresAt < new Date()) return null;
  return user;
}

/** Validates the link and returns who it's for, so the page can say "Resetting MFA for <name>". */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const user = await resolveUser(params.token);
  if (!user) {
    return NextResponse.json({ error: "This link is invalid or has expired. Request a new one." }, { status: 404 });
  }
  return NextResponse.json({ name: user.name, email: user.email });
}

/**
 * Redoes MFA setup for the account this (emailed, single-use) token
 * belongs to — no session or password required, since the whole point is
 * recovering from a lost device. Never logs the user in; on success they
 * still need to sign in normally with their password afterward, which is
 * what proves this wasn't just someone who intercepted the email.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const user = await resolveUser(params.token);
  if (!user) {
    return NextResponse.json({ error: "This link is invalid or has expired. Request a new one." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === "begin") {
    const { qrDataUrl, secretBase32 } = await beginMfaSetup(user.id, user.email);
    return NextResponse.json({ qrDataUrl, secretBase32, email: user.email });
  }

  if (action === "confirm") {
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!code) return NextResponse.json({ error: "Enter the 6-digit code from your authenticator app." }, { status: 400 });

    const result = await confirmMfaSetup(user.id, code);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    // One-time link — burn it so it can't be reused even though it hasn't expired yet.
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaResetTokenHash: null, mfaResetExpiresAt: null },
    });
    await logAudit({ actorEmail: user.email, actorId: user.id, action: "MFA_RESET_VIA_EMAIL" });

    return NextResponse.json({ ok: true, backupCodes: result.backupCodes });
  }

  return NextResponse.json({ error: 'action must be "begin" or "confirm".' }, { status: 400 });
}
