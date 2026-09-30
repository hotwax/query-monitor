import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { roleAllows, CAN_REVEAL_KILL_COMMAND } from "@/lib/rbac";
import { resolveKillCredentials } from "@/lib/kill-credentials";
import { NEVER_MONITOR_OR_KILL_USERS } from "@/lib/mysql-collector";

const CONNECT_TIMEOUT_MS = 5000;

function clamp(v: unknown, max = 2000): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v.length > max ? v.slice(0, max) + "…" : v;
}

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
 * Always kills the WHOLE connection (mysql.rds_kill / plain KILL) —
 * matching exactly the `KILL <id>;` this team always ran by hand, which
 * also drops any locks the connection was holding, not just the one
 * statement. There is deliberately no "kill just the query, leave the
 * connection open" path here (that would be mysql.rds_kill_query / KILL
 * QUERY) — this app only ever does a full kill.
 *
 * Every attempt is logged — success (KILL_EXECUTED) or failure
 * (KILL_FAILED) — with who, when, which machine/process, and the captured
 * query context. See also VIEWED_KILL_PAGE and CHECKED_STATUS, logged
 * elsewhere in this same flow, for the full trail.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_REVEAL_KILL_COMMAND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const connectionId = typeof body?.connectionId === "string" ? body.connectionId : null;
  const processId = Number(body?.processId);
  // Always a full connection kill — see the module doc comment above.
  const method = "CONNECTION" as const;
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

  const baseDetail = {
    processId,
    method,
    connectionName: connection.name,
    dbUsername: capturedDbUsername,
    database: capturedDatabase,
    queryText: capturedQueryText,
  };

  let username: string;
  let password: string;
  try {
    ({ username, password } = resolveKillCredentials(connection));
  } catch (err) {
    const message = err instanceof Error ? err.message : "No kill account credential configured.";
    const isConfigMissing = message.includes("No kill account credential available");
    if (!isConfigMissing) {
      console.error(`[kill-execute] Failed to resolve kill account credential for ${connection.name}.`, err);
    }
    await logAudit({
      actorEmail: session.email,
      actorId: session.sub,
      action: "KILL_FAILED",
      connectionId,
      detail: { ...baseDetail, error: "credential-resolution-failed" },
    });
    return NextResponse.json(
      {
        error: isConfigMissing
          ? message
          : `Could not resolve the kill account credential for ${connection.name}. This usually means APP_ENCRYPTION_KEY changed since a per-machine override was saved.`,
      },
      { status: isConfigMissing ? 409 : 500 }
    );
  }

  const statement = connection.killMethod === "DIRECT_KILL" ? `KILL ${processId}` : "CALL mysql.rds_kill(?)";
  // Plain KILL doesn't support a bound placeholder in MySQL, so DIRECT_KILL
  // inlines processId directly — safe here since it was validated with
  // Number.isFinite above, never taken from a raw string.
  const params = connection.killMethod === "DIRECT_KILL" ? [] : [processId];

  // Never-kill list: MySQL/MariaDB/AWS-RDS-internal accounts. Derived from
  // the SAME array mysql-collector.ts uses to keep these accounts off
  // every list the app shows (see NEVER_MONITOR_OR_KILL_USERS there for
  // the full, evidence-backed rationale for each entry) — one shared
  // source of truth, so the display filter and this kill-safety gate can
  // never drift out of sync. Killing one of these (e.g. a replica's
  // replication threads, or an RDS-internal management account) risks
  // breaking replication or RDS's own management of the instance, a far
  // bigger incident than any slow query this app exists to catch. This is
  // the actual safety boundary: it's checked here, live, right before the
  // kill executes, using the CURRENT PROCESSLIST state rather than
  // trusting whatever the client sent — so a stale UI, a reused/recycled
  // process id, or a hand-crafted request all get the same protection,
  // not just the dashboard's display.
  const NEVER_KILL_USERS = new Set<string>(NEVER_MONITOR_OR_KILL_USERS);

  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: connection.host,
      port: connection.port,
      user: username,
      password,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });

    const [liveRows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT USER FROM information_schema.PROCESSLIST WHERE ID = ?",
      [processId]
    );
    const liveUser: string | null = liveRows[0]?.USER ?? null;

    if (liveUser === null) {
      await logAudit({
        actorEmail: session.email,
        actorId: session.sub,
        action: "KILL_FAILED",
        connectionId,
        detail: { ...baseDetail, error: "process-no-longer-running" },
      });
      return NextResponse.json(
        { error: `Process ${processId} is no longer running — nothing to kill.` },
        { status: 409 }
      );
    }

    if (NEVER_KILL_USERS.has(liveUser)) {
      await logAudit({
        actorEmail: session.email,
        actorId: session.sub,
        action: "KILL_BLOCKED_SYSTEM_PROCESS",
        connectionId,
        detail: { ...baseDetail, liveUser },
      });
      return NextResponse.json(
        {
          error: `Refused: process ${processId} belongs to MySQL/MariaDB's or AWS RDS's internal "${liveUser}" account. Killing it could break replication or RDS's own management of this instance. This app will never kill this account, regardless of what triggered the request.`,
        },
        { status: 403 }
      );
    }

    await conn.query(statement, params);

    await logAudit({
      actorEmail: session.email,
      actorId: session.sub,
      action: "KILL_EXECUTED",
      connectionId,
      detail: { ...baseDetail, killAccount: username },
    });

    return NextResponse.json({ ok: true, processId, method, connectionName: connection.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error while killing the query.";
    console.error(`[kill-execute] Failed to kill process ${processId} on ${connection.name}:`, err);
    await logAudit({
      actorEmail: session.email,
      actorId: session.sub,
      action: "KILL_FAILED",
      connectionId,
      detail: { ...baseDetail, killAccount: username, error: clamp(message, 500) },
    });
    return NextResponse.json(
      { error: `Could not kill process ${processId}: ${message}` },
      { status: 502 }
    );
  } finally {
    await conn?.end().catch(() => undefined);
  }
}
