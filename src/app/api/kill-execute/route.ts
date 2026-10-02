import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { roleAllows, CAN_REVEAL_KILL_COMMAND } from "@/lib/rbac";
import { killProcess, clamp } from "@/lib/kill-process";

/**
 * Actually kills a query/session — the one deliberate exception to this
 * app's original "never execute anything" rule. That rule existed because
 * killing traditionally meant authenticating as somebody's real DB user;
 * now it authenticates as ONE dedicated, narrowly-scoped account (see
 * src/lib/kill-credentials.ts and prisma/rds-kill-user.sql) that can only
 * ever call mysql.rds_kill (or plain KILL, for a self-managed DIRECT_KILL
 * machine) — no table data access, no user management. Given that
 * account's blast radius is "can terminate a session," letting the app run
 * it behind a typed, explicit confirmation (see KillCommandPanel.tsx)
 * removes a manual copy/paste step without meaningfully changing what a
 * compromised session could do.
 *
 * This route handles exactly ONE process. See /api/kill-execute-bulk for
 * killing several at once from the Dashboard's bulk-select — both routes
 * call the same src/lib/kill-process.ts for the actual safety-checked kill,
 * so the live pre-kill check and the audit trail can never drift apart
 * between the two.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_REVEAL_KILL_COMMAND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const connectionId = typeof body?.connectionId === "string" ? body.connectionId : null;
  const processId = Number(body?.processId);
  const capturedDbUsername = clamp(body?.dbUsername, 200);
  const capturedDatabase = clamp(body?.database, 200);
  const capturedQueryText = clamp(body?.queryText);

  if (!connectionId || !Number.isFinite(processId)) {
    return NextResponse.json({ error: "connectionId and processId are required." }, { status: 400 });
  }

  const connection = await prisma.dbConnection.findUnique({ where: { id: connectionId } });
  if (!connection) {
    return NextResponse.json({ error: "Unknown database machine." }, { status: 404 });
  }

  const result = await killProcess({
    connection,
    processId,
    actorEmail: session.email,
    actorId: session.sub,
    captured: { dbUsername: capturedDbUsername, database: capturedDatabase, queryText: capturedQueryText },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  }
  return NextResponse.json({ ok: true, processId, method: "CONNECTION", connectionName: connection.name });
}
