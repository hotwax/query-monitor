import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getPendingSession,
  clearPendingCookie,
  createSessionToken,
  setSessionCookie,
} from "@/lib/session";
import { verifyMfaLogin } from "@/lib/mfa";
import { logAudit } from "@/lib/audit";
import { isRole } from "@/lib/types";

/**
 * Step 2 of login for an account that already has MFA enabled: checks the
 * 6-digit authenticator code (or a backup code) against the pending user
 * from /api/auth/login, and only on success issues the real session
 * cookie. Rate-limited/lockout is handled in src/lib/mfa.ts.
 */
export async function POST(req: NextRequest) {
  const pending = await getPendingSession("MFA_VERIFY");
  if (!pending) {
    return NextResponse.json({ error: "Your login attempt expired. Please sign in again." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : undefined;
  const backupCode = typeof body?.backupCode === "string" ? body.backupCode.trim() : undefined;
  if (!code && !backupCode) {
    return NextResponse.json({ error: "Enter the code from your authenticator app." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: pending.sub } });
  if (!user || !isRole(user.role) || user.status !== "ACTIVE" || !user.mfaEnabled) {
    clearPendingCookie();
    return NextResponse.json({ error: "Your login attempt expired. Please sign in again." }, { status: 401 });
  }

  const result = await verifyMfaLogin(user.id, { code, backupCode });
  if (!result.ok) {
    await logAudit({ actorEmail: user.email, actorId: user.id, action: "MFA_LOGIN_FAILED" });
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  clearPendingCookie();
  const token = await createSessionToken({ sub: user.id, email: user.email, role: user.role });
  await setSessionCookie(token);
  await logAudit({
    actorEmail: user.email,
    actorId: user.id,
    action: "MFA_LOGIN_SUCCESS",
    detail: result.usedBackupCode ? { usedBackupCode: true, backupCodesRemaining: result.backupCodesRemaining } : undefined,
  });
  await logAudit({ actorEmail: user.email, actorId: user.id, action: "LOGIN" });

  return NextResponse.json({
    ok: true,
    role: user.role,
    usedBackupCode: result.usedBackupCode,
    backupCodesRemaining: result.backupCodesRemaining,
  });
}
