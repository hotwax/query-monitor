import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPendingSession, clearPendingCookie, createSessionToken, setSessionCookie } from "@/lib/session";
import { confirmMfaSetup } from "@/lib/mfa";
import { logAudit } from "@/lib/audit";
import { isRole } from "@/lib/types";

/**
 * Confirms first-time MFA setup with the current code from the app. On
 * success, MFA is enabled, backup codes are minted and returned once, and
 * — since this is the very last step of logging in for an account that
 * didn't have MFA yet — the real session cookie is issued right here.
 */
export async function POST(req: NextRequest) {
  const pending = await getPendingSession("MFA_SETUP");
  if (!pending) {
    return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) {
    return NextResponse.json({ error: "Enter the 6-digit code from your authenticator app." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: pending.sub } });
  if (!user || !isRole(user.role) || user.status !== "ACTIVE") {
    return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });
  }

  const result = await confirmMfaSetup(user.id, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  clearPendingCookie();
  const token = await createSessionToken({ sub: user.id, email: user.email, role: user.role });
  await setSessionCookie(token);
  await logAudit({ actorEmail: user.email, actorId: user.id, action: "MFA_ENABLED" });
  await logAudit({ actorEmail: user.email, actorId: user.id, action: "LOGIN" });

  return NextResponse.json({ ok: true, role: user.role, backupCodes: result.backupCodes });
}
