import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { roleAllows, CAN_MANAGE_USERS } from "@/lib/rbac";
import { clearMfa } from "@/lib/mfa";
import { logAudit } from "@/lib/audit";

/**
 * Last-resort recovery: if someone loses their phone AND can't get into
 * their account email (so the self-service /mfa/recovery link isn't an
 * option either), an admin can wipe their MFA entirely — they'll be forced
 * through setup again on their next login, same as a brand-new user.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_MANAGE_USERS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

  await clearMfa(target.id);
  await logAudit({
    actorEmail: session.email,
    actorId: session.sub,
    action: "MFA_RESET_BY_ADMIN",
    detail: { targetUserId: target.id, targetEmail: target.email },
  });

  return NextResponse.json({ ok: true });
}
