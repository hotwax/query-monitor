import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPendingSession } from "@/lib/session";
import { beginMfaSetup } from "@/lib/mfa";

/**
 * Starts (or restarts) first-time MFA setup for the account that just
 * passed the password check in /api/auth/login and doesn't have MFA
 * enabled yet. Requires the MFA_SETUP pending cookie — not a full session,
 * since this account isn't fully logged in until setup is confirmed (see
 * /api/mfa/setup/confirm).
 */
export async function POST() {
  const pending = await getPendingSession("MFA_SETUP");
  if (!pending) {
    return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: pending.sub } });
  if (!user) {
    return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });
  }

  const { qrDataUrl, secretBase32 } = await beginMfaSetup(user.id, user.email);
  return NextResponse.json({ qrDataUrl, secretBase32, email: user.email });
}
