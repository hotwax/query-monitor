import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { roleAllows, CAN_MANAGE_USERS } from "@/lib/rbac";
import { generateToken } from "@/lib/tokens";
import { sendEmail, appBaseUrl } from "@/lib/email";
import { logAudit } from "@/lib/audit";

const INVITE_TTL_DAYS = 7;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_MANAGE_USERS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (target.status !== "INVITED") {
    return NextResponse.json({ error: "This user has already accepted their invite." }, { status: 400 });
  }

  const { raw, hash } = generateToken();
  await prisma.user.update({
    where: { id: target.id },
    data: { inviteTokenHash: hash, inviteExpiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000) },
  });

  const link = `${appBaseUrl()}/invite/${raw}`;
  await sendEmail({
    to: target.email,
    subject: "Your Query Monitor invite",
    text: `Hi ${target.name},\n\nHere's a fresh invite link — the previous one expired or wasn't used yet:\n\n${link}\n\nThis link expires in ${INVITE_TTL_DAYS} days.`,
    html: `<p>Hi ${target.name},</p><p>Here's a fresh invite link — the previous one expired or wasn't used yet:</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>`,
  });

  await logAudit({
    actorEmail: session.email,
    actorId: session.sub,
    action: "USER_INVITE_RESENT",
    detail: { targetUserId: target.id, targetEmail: target.email },
  });

  return NextResponse.json({ ok: true });
}
