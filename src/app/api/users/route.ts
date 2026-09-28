import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { roleAllows, CAN_MANAGE_USERS } from "@/lib/rbac";
import { isRole } from "@/lib/types";
import { generateToken } from "@/lib/tokens";
import { sendEmail, appBaseUrl } from "@/lib/email";
import { logAudit } from "@/lib/audit";

const INVITE_TTL_DAYS = 7;

// GET is used by the admin "Users" page. Middleware already restricts
// /api/users/* to ADMIN. Never returns passwordHash or any MFA secret.
export async function GET() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      role: true,
      status: true,
      mfaEnabled: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ users });
}

async function sendInviteEmail(user: { name: string; email: string }, rawToken: string) {
  const link = `${appBaseUrl()}/invite/${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: "You've been invited to Query Monitor",
    text:
      `Hi ${user.name},\n\nYou've been invited to Query Monitor. Click the link below to set your ` +
      `password and finish setting up your account (including multi-factor authentication, which is ` +
      `required):\n\n${link}\n\nThis link expires in ${INVITE_TTL_DAYS} days.`,
    html:
      `<p>Hi ${user.name},</p><p>You've been invited to Query Monitor. Click the link below to set your ` +
      `password and finish setting up your account (including multi-factor authentication, which is ` +
      `required):</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>`,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_MANAGE_USERS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body?.role;

  if (!username || !name || !email) {
    return NextResponse.json({ error: "username, name, and email are required." }, { status: 400 });
  }
  if (!isRole(role)) {
    return NextResponse.json({ error: 'role must be "DEVELOPER", "DEVOPS", or "ADMIN".' }, { status: 400 });
  }

  const { raw, hash } = generateToken();

  let user;
  try {
    user = await prisma.user.create({
      data: {
        username,
        name,
        email,
        role,
        status: "INVITED",
        inviteTokenHash: hash,
        inviteExpiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return NextResponse.json({ error: "That username or email is already in use." }, { status: 409 });
    }
    throw err;
  }

  try {
    await sendInviteEmail(user, raw);
  } catch (err) {
    console.error("[users] Failed to send invite email:", err);
    return NextResponse.json(
      { error: "User was created, but the invite email failed to send. Use Resend invite to try again." },
      { status: 502 }
    );
  }

  await logAudit({
    actorEmail: session.email,
    actorId: session.sub,
    action: "USER_INVITED",
    detail: { targetUserId: user.id, targetEmail: user.email, role: user.role },
  });

  return NextResponse.json({ id: user.id }, { status: 201 });
}
