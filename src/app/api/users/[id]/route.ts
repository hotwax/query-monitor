import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { roleAllows, CAN_MANAGE_USERS } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";

/** Disable/enable a user (offboarding). Guards against locking yourself out or disabling the last active admin. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_MANAGE_USERS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "disable" && action !== "enable") {
    return NextResponse.json({ error: 'action must be "disable" or "enable".' }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (action === "disable") {
    if (target.id === session.sub) {
      return NextResponse.json({ error: "You can't disable your own account." }, { status: 400 });
    }
    if (target.role === "ADMIN") {
      const otherActiveAdmins = await prisma.user.count({
        where: { role: "ADMIN", status: "ACTIVE", id: { not: target.id } },
      });
      if (otherActiveAdmins === 0) {
        return NextResponse.json({ error: "Can't disable the last active admin account." }, { status: 400 });
      }
    }
  }

  const newStatus = action === "disable" ? "DISABLED" : "ACTIVE";
  // Re-enabling an INVITED (never-accepted) account just leaves it INVITED — nothing to "enable" yet.
  if (target.status === "INVITED" && action === "enable") {
    return NextResponse.json({ error: "This user hasn't accepted their invite yet." }, { status: 400 });
  }

  await prisma.user.update({ where: { id: target.id }, data: { status: newStatus } });
  await logAudit({
    actorEmail: session.email,
    actorId: session.sub,
    action: action === "disable" ? "USER_DISABLED" : "USER_ENABLED",
    detail: { targetUserId: target.id, targetEmail: target.email },
  });

  return NextResponse.json({ ok: true, status: newStatus });
}

/**
 * Permanently deletes a user account. Disable stays the right choice for
 * normal offboarding (reversible); delete is for accounts that should not
 * exist at all — a mistyped invite, someone who never joined, a test user.
 *
 * Past audit-log / kill-log rows are kept: AuditLog.actorId is
 * ON DELETE SET NULL and every row also stores actorEmail, so "who killed
 * what" stays readable after the account is gone.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_MANAGE_USERS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (target.id === session.sub) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }

  if (target.role === "ADMIN" && target.status === "ACTIVE") {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: "ADMIN", status: "ACTIVE", id: { not: target.id } },
    });
    if (otherActiveAdmins === 0) {
      return NextResponse.json({ error: "Can't delete the last active admin account." }, { status: 400 });
    }
  }

  await prisma.user.delete({ where: { id: target.id } });
  await logAudit({
    actorEmail: session.email,
    actorId: session.sub,
    action: "USER_DELETED",
    detail: { targetUserId: target.id, targetEmail: target.email, targetRole: target.role, targetStatus: target.status },
  });

  return NextResponse.json({ ok: true });
}
