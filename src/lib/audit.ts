import { prisma } from "@/lib/db";

/**
 * Every login, every dashboard view, and — most importantly — every time a
 * kill command (which includes a live DB password) is revealed, gets
 * written here. Never pass a plaintext password into `detail`.
 */
export async function logAudit(params: {
  actorEmail: string;
  actorId?: string;
  action:
    | "LOGIN"
    | "LOGIN_FAILED"
    | "VIEW_QUERIES"
    // Legacy actions from the earlier "reveal a command, run it yourself"
    // design — kept so old audit rows still display correctly. New activity
    // uses the actions below instead, now that the app executes kills
    // itself (via the dedicated kill account) behind a typed confirmation.
    | "REVEAL_KILL_COMMAND"
    | "CONFIRMED_KILL"
    // Current design's full event trail for one kill attempt:
    | "VIEWED_KILL_PAGE"
    | "CHECKED_STATUS"
    | "KILL_EXECUTED"
    | "KILL_FAILED"
    // MFA (see src/lib/mfa.ts and the /mfa/* routes/pages):
    | "MFA_ENABLED"
    | "MFA_LOGIN_SUCCESS"
    | "MFA_LOGIN_FAILED"
    | "MFA_RESET_REQUESTED"
    | "MFA_RESET_VIA_EMAIL"
    | "MFA_RESET_BY_ADMIN"
    // User management / invites (see /admin/users and /api/users/*):
    | "USER_INVITED"
    | "USER_INVITE_RESENT"
    | "USER_INVITE_ACCEPTED"
    | "USER_DISABLED"
    | "USER_ENABLED";
  connectionId?: string;
  detail?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      actorEmail: params.actorEmail,
      actorId: params.actorId,
      action: params.action,
      connectionId: params.connectionId,
      detail: params.detail ? JSON.stringify(params.detail) : undefined,
    },
  });
}
