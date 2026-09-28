import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createPendingToken, setPendingCookie } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { isRole } from "@/lib/types";

/**
 * Step 1 of 2: username + password. Never issues the real session cookie by
 * itself — on success it issues a short-lived "pending" cookie and tells
 * the client where to go next:
 *   - mfaEnabled already true  -> /mfa/verify (enter the 6-digit code)
 *   - mfaEnabled still false   -> /mfa/setup  (scan a QR code first — this
 *     covers both a freshly-invited user's very first login and any
 *     pre-existing account that hasn't set MFA up yet)
 * See /api/auth/mfa-verify and /api/mfa/setup for step 2.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !valid || !isRole(user.role)) {
    await logAudit({ actorEmail: email, action: "LOGIN_FAILED" });
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  if (user.status === "INVITED") {
    return NextResponse.json(
      { error: "This account hasn't accepted its invite yet — check your email for the invite link." },
      { status: 403 }
    );
  }
  if (user.status === "DISABLED") {
    await logAudit({ actorEmail: user.email, actorId: user.id, action: "LOGIN_FAILED" });
    return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
  }

  const purpose = user.mfaEnabled ? "MFA_VERIFY" : "MFA_SETUP";
  const pendingToken = await createPendingToken({ sub: user.id, purpose });
  await setPendingCookie(pendingToken);

  return NextResponse.json({ ok: true, next: user.mfaEnabled ? "/mfa/verify" : "/mfa/setup" });
}
