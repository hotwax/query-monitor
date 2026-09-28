import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { hashToken, tokensMatch } from "@/lib/tokens";
import { createPendingToken, setPendingCookie } from "@/lib/session";
import { logAudit } from "@/lib/audit";

async function resolveInvite(token: string) {
  const hash = hashToken(token);
  const user = await prisma.user.findFirst({ where: { inviteTokenHash: hash } });
  if (!user || !tokensMatch(user.inviteTokenHash, hash)) return null;
  if (user.status !== "INVITED") return null;
  if (!user.inviteExpiresAt || user.inviteExpiresAt < new Date()) return null;
  return user;
}

/** Validates the invite link and returns the (pre-filled, read-only) account details. */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const user = await resolveInvite(params.token);
  if (!user) {
    return NextResponse.json({ error: "This invite is invalid or has expired. Ask an admin to resend it." }, { status: 404 });
  }
  return NextResponse.json({ username: user.username, name: user.name, email: user.email, role: user.role });
}

/**
 * Accepts the invite: sets the password, activates the account, and — like
 * a normal login's password step — issues a pending MFA_SETUP cookie
 * rather than a real session, since MFA is required before this account
 * can actually be used.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const user = await resolveInvite(params.token);
  if (!user) {
    return NextResponse.json({ error: "This invite is invalid or has expired. Ask an admin to resend it." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 10) {
    return NextResponse.json({ error: "Password must be at least 10 characters." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, status: "ACTIVE", inviteTokenHash: null, inviteExpiresAt: null },
  });
  await logAudit({ actorEmail: user.email, actorId: user.id, action: "USER_INVITE_ACCEPTED" });

  const pendingToken = await createPendingToken({ sub: user.id, purpose: "MFA_SETUP" });
  await setPendingCookie(pendingToken);

  return NextResponse.json({ ok: true, next: "/mfa/setup" });
}
