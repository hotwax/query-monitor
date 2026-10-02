import mysql from "mysql2/promise";
import type { DbConnection } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { NEVER_MONITOR_OR_KILL_USERS } from "@/lib/mysql-collector";
import { resolveKillCredentials } from "@/lib/kill-credentials";

const CONNECT_TIMEOUT_MS = 5000;

// Never-kill list: MySQL/MariaDB/AWS-RDS-internal accounts. Derived from the
// SAME array mysql-collector.ts uses to keep these accounts off every list
// the app shows (see NEVER_MONITOR_OR_KILL_USERS there for the full,
// evidence-backed rationale for each entry) — one shared source of truth, so
// the display filter and this kill-safety gate can never drift out of sync.
const NEVER_KILL_USERS = new Set<string>(NEVER_MONITOR_OR_KILL_USERS);

export function clamp(v: unknown, max = 2000): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v.length > max ? v.slice(0, max) + "…" : v;
}

export interface CapturedQueryDetail {
  dbUsername: string | null;
  database: string | null;
  queryText: string | null;
}

export interface KillResult {
  processId: number;
  ok: boolean;
  error?: string;
  /** HTTP-ish status, for callers that map one result straight to a response. */
  status?: number;
}

/**
 * Does the actual work of killing ONE process on ONE machine — live
 * pre-kill safety check, the kill itself, and the audit trail — used by
 * BOTH /api/kill-execute (one query at a time) and /api/kill-execute-bulk
 * (many at once). Pulled out into one shared function so the two routes can
 * never drift apart on the safety-critical part: the live re-check against
 * NEVER_MONITOR_OR_KILL_USERS happens here, once, right before every single
 * kill, using the CURRENT PROCESSLIST state rather than trusting whatever
 * the caller believes is still running.
 *
 * Always a full connection kill (mysql.rds_kill / plain KILL) — see the
 * module doc comment on the original /api/kill-execute route for why there
 * is deliberately no "kill just the query" path.
 */
export async function killProcess(params: {
  connection: DbConnection;
  processId: number;
  actorEmail: string;
  actorId?: string;
  captured: CapturedQueryDetail;
  /** Tags the audit entry so it's visible in Kill Log detail that this kill was part of a bulk action. */
  bulk?: boolean;
}): Promise<KillResult> {
  const { connection, processId, actorEmail, actorId, captured, bulk } = params;

  const baseDetail = {
    processId,
    method: "CONNECTION" as const,
    connectionName: connection.name,
    dbUsername: captured.dbUsername,
    database: captured.database,
    queryText: captured.queryText,
    ...(bulk ? { bulk: true } : {}),
  };

  let username: string;
  let password: string;
  try {
    ({ username, password } = resolveKillCredentials(connection));
  } catch (err) {
    const message = err instanceof Error ? err.message : "No kill account credential configured.";
    const isConfigMissing = message.includes("No kill account credential available");
    if (!isConfigMissing) {
      console.error(`[kill-process] Failed to resolve kill account credential for ${connection.name}.`, err);
    }
    await logAudit({
      actorEmail,
      actorId,
      action: "KILL_FAILED",
      connectionId: connection.id,
      detail: { ...baseDetail, error: "credential-resolution-failed" },
    });
    return {
      processId,
      ok: false,
      status: isConfigMissing ? 409 : 500,
      error: isConfigMissing
        ? message
        : `Could not resolve the kill account credential for ${connection.name}. This usually means APP_ENCRYPTION_KEY changed since a per-machine override was saved.`,
    };
  }

  const statement = connection.killMethod === "DIRECT_KILL" ? `KILL ${processId}` : "CALL mysql.rds_kill(?)";
  // Plain KILL doesn't support a bound placeholder in MySQL, so DIRECT_KILL
  // inlines processId directly — safe here since it was validated as a
  // finite number before this function is ever called.
  const statementParams = connection.killMethod === "DIRECT_KILL" ? [] : [processId];

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
        actorEmail,
        actorId,
        action: "KILL_FAILED",
        connectionId: connection.id,
        detail: { ...baseDetail, error: "process-no-longer-running" },
      });
      return {
        processId,
        ok: false,
        status: 409,
        error: `Process ${processId} is no longer running — nothing to kill.`,
      };
    }

    if (NEVER_KILL_USERS.has(liveUser)) {
      await logAudit({
        actorEmail,
        actorId,
        action: "KILL_BLOCKED_SYSTEM_PROCESS",
        connectionId: connection.id,
        detail: { ...baseDetail, liveUser },
      });
      return {
        processId,
        ok: false,
        status: 403,
        error: `Refused: process ${processId} belongs to MySQL/MariaDB's or AWS RDS's internal "${liveUser}" account. Killing it could break replication or RDS's own management of this instance. This app will never kill this account, regardless of what triggered the request.`,
      };
    }

    await conn.query(statement, statementParams);

    await logAudit({
      actorEmail,
      actorId,
      action: "KILL_EXECUTED",
      connectionId: connection.id,
      detail: { ...baseDetail, killAccount: username },
    });

    return { processId, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error while killing the query.";
    console.error(`[kill-process] Failed to kill process ${processId} on ${connection.name}:`, err);
    await logAudit({
      actorEmail,
      actorId,
      action: "KILL_FAILED",
      connectionId: connection.id,
      detail: { ...baseDetail, killAccount: username, error: clamp(message, 500) },
    });
    return { processId, ok: false, status: 502, error: `Could not kill process ${processId}: ${message}` };
  } finally {
    await conn?.end().catch(() => undefined);
  }
}
