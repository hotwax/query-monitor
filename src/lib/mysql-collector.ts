import mysql from "mysql2/promise";
import { resolveMonitorCredentials } from "@/lib/monitor-credentials";
import type { DbConnection } from "@prisma/client";

export interface RunningQuery {
  connectionId: string;
  connectionName: string;
  processId: number;
  dbUsername: string;
  clientHost: string | null;
  database: string | null;
  command: string;
  /** Seconds the query/connection has been in its current state. */
  durationSeconds: number;
  state: string | null;
  queryText: string | null;
}

/**
 * One blocked-on-a-lock situation: some session (waitingPid) is stuck
 * waiting for a row/table lock that another session (blockingPid) is
 * holding. This is a DIFFERENT problem from "long-running" — the blocking
 * session is very often fast and idle-in-transaction (nothing shows up as
 * slow), while everything queued behind its lock silently piles up until
 * something kills it or it finally commits/rolls back. See
 * "Locked / blocked queries" in the dashboard, deliberately shown above
 * long-running queries: the blocking session is usually the one actually
 * worth killing, and it's easy to miss since its own duration can look
 * perfectly ordinary.
 */
export interface LockWait {
  connectionId: string;
  connectionName: string;
  waitingPid: number;
  waitingQuery: string | null;
  waitingDbUsername: string | null;
  waitingClientHost: string | null;
  waitingDatabase: string | null;
  /** How long this session has been stuck waiting for the lock, in seconds. */
  waitSeconds: number;
  blockingPid: number;
  blockingQuery: string | null;
  blockingDbUsername: string | null;
  blockingClientHost: string | null;
  blockingDatabase: string | null;
}

const CONNECT_TIMEOUT_MS = 5000;

// AWS's own recommended query for RDS/Aurora MySQL 8.0+ (see "Troubleshoot
// blocked MySQL queries on Amazon RDS DB instances"), joining the MySQL 8
// lock-wait graph (performance_schema.data_lock_waits) against
// information_schema.innodb_trx to resolve each side back to a plain
// PROCESSLIST id (trx_mysql_thread_id) — the same id everything else in
// this app (Kill Query included) already works with.
const LOCK_WAITS_SQL_MYSQL8 = `
  SELECT
    b.trx_mysql_thread_id AS blocking_pid,
    b.trx_query AS blocking_query,
    bp.USER AS blocking_user,
    bp.HOST AS blocking_host,
    bp.DB AS blocking_db,
    r.trx_mysql_thread_id AS waiting_pid,
    r.trx_query AS waiting_query,
    rp.USER AS waiting_user,
    rp.HOST AS waiting_host,
    rp.DB AS waiting_db,
    TIMESTAMPDIFF(SECOND, r.trx_wait_started, NOW()) AS wait_seconds
  FROM performance_schema.data_lock_waits w
  INNER JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_engine_transaction_id
  INNER JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_engine_transaction_id
  LEFT JOIN information_schema.PROCESSLIST bp ON bp.ID = b.trx_mysql_thread_id
  LEFT JOIN information_schema.PROCESSLIST rp ON rp.ID = r.trx_mysql_thread_id
`;

// MariaDB, and MySQL 5.7 and earlier, never had performance_schema.
// data_lock_waits — this is the older equivalent (removed in MySQL 8.0,
// still present everywhere else), same idea: a lock-wait graph joined back
// to innodb_trx for the PROCESSLIST id. Tried automatically as a fallback
// when the query above fails with "table doesn't exist", so nothing needs
// configuring per machine.
const LOCK_WAITS_SQL_CLASSIC = `
  SELECT
    b.trx_mysql_thread_id AS blocking_pid,
    b.trx_query AS blocking_query,
    bp.USER AS blocking_user,
    bp.HOST AS blocking_host,
    bp.DB AS blocking_db,
    r.trx_mysql_thread_id AS waiting_pid,
    r.trx_query AS waiting_query,
    rp.USER AS waiting_user,
    rp.HOST AS waiting_host,
    rp.DB AS waiting_db,
    TIMESTAMPDIFF(SECOND, r.trx_wait_started, NOW()) AS wait_seconds
  FROM information_schema.INNODB_LOCK_WAITS lw
  INNER JOIN information_schema.innodb_trx b ON b.trx_id = lw.blocking_trx_id
  INNER JOIN information_schema.innodb_trx r ON r.trx_id = lw.requesting_trx_id
  LEFT JOIN information_schema.PROCESSLIST bp ON bp.ID = b.trx_mysql_thread_id
  LEFT JOIN information_schema.PROCESSLIST rp ON rp.ID = r.trx_mysql_thread_id
`;

async function queryLockWaits(conn: mysql.Connection): Promise<Omit<LockWait, "connectionId" | "connectionName">[]> {
  let rows: mysql.RowDataPacket[];
  try {
    [rows] = await conn.query<mysql.RowDataPacket[]>(LOCK_WAITS_SQL_MYSQL8);
  } catch {
    try {
      [rows] = await conn.query<mysql.RowDataPacket[]>(LOCK_WAITS_SQL_CLASSIC);
    } catch {
      // Neither lock-wait table exists on this engine/version — fail open.
      // Long-running/all-queries detection is unaffected either way.
      return [];
    }
  }

  return rows.map((row) => ({
    waitingPid: Number(row.waiting_pid),
    waitingQuery: row.waiting_query ? String(row.waiting_query) : null,
    waitingDbUsername: row.waiting_user ? String(row.waiting_user) : null,
    waitingClientHost: row.waiting_host ? String(row.waiting_host) : null,
    waitingDatabase: row.waiting_db ? String(row.waiting_db) : null,
    waitSeconds: Number(row.wait_seconds),
    blockingPid: Number(row.blocking_pid),
    blockingQuery: row.blocking_query ? String(row.blocking_query) : null,
    blockingDbUsername: row.blocking_user ? String(row.blocking_user) : null,
    blockingClientHost: row.blocking_host ? String(row.blocking_host) : null,
    blockingDatabase: row.blocking_db ? String(row.blocking_db) : null,
  }));
}

// information_schema.processlist requires the PROCESS privilege to see
// other users' threads (RDS/Aurora support this for a plain grant, no
// SUPER needed). We exclude our own monitoring connection and idle
// sleeping connections, and only keep genuinely executing queries.
const PROCESSLIST_SQL = `
  SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO
  FROM information_schema.PROCESSLIST
  WHERE COMMAND NOT IN ('Sleep', 'Daemon', 'Binlog Dump')
    AND USER != ?
    AND TIME >= ?
  ORDER BY TIME DESC
`;

function mapProcesslistRows(
  rows: mysql.RowDataPacket[],
  connection: Pick<DbConnection, "id" | "name">
): RunningQuery[] {
  return rows.map((row) => ({
    connectionId: connection.id,
    connectionName: connection.name,
    processId: Number(row.ID),
    dbUsername: String(row.USER),
    clientHost: row.HOST ? String(row.HOST) : null,
    database: row.DB ? String(row.DB) : null,
    command: String(row.COMMAND),
    durationSeconds: Number(row.TIME),
    state: row.STATE ? String(row.STATE) : null,
    queryText: row.INFO ? String(row.INFO) : null,
  }));
}

/**
 * Connects to one registered MySQL/MariaDB machine using its dedicated
 * READ-ONLY monitoring user (see prisma/rds-readonly-user.sql) and returns
 * every currently-running query (longest-running first) plus every active
 * lock-wait situation, in one connection.
 *
 * This ONLY ever runs SELECT/SHOW statements. It never writes, and it
 * never issues KILL — see src/app/api/kill-execute/route.ts for why that's
 * a deliberate, separate, human-in-the-loop step.
 */
export async function collectMachineData(
  connection: Pick<DbConnection, "id" | "name" | "host" | "port" | "monitorUsername" | "monitorPasswordEnc">,
  opts: { minDurationSeconds?: number } = {}
): Promise<{ queries: RunningQuery[]; lockWaits: LockWait[] }> {
  const minDurationSeconds = opts.minDurationSeconds ?? 0;
  const { username, password } = resolveMonitorCredentials(connection);

  const conn = await mysql.createConnection({
    host: connection.host,
    port: connection.port,
    user: username,
    password,
    connectTimeout: CONNECT_TIMEOUT_MS,
    // This account should only ever have PROCESS + performance_schema
    // SELECT grants, but we also never build dynamic SQL from user input
    // here, so there's no injection surface regardless.
  });

  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(PROCESSLIST_SQL, [username, minDurationSeconds]);
    const queries = mapProcesslistRows(rows, connection);

    const lockWaitRows = await queryLockWaits(conn);
    const lockWaits = lockWaitRows.map((lw) => ({ ...lw, connectionId: connection.id, connectionName: connection.name }));

    return { queries, lockWaits };
  } finally {
    await conn.end().catch(() => undefined);
  }
}

/**
 * A lighter version of collectMachineData for the slow-query history
 * scanner (src/lib/slow-query-scanner.ts): just the PROCESSLIST query,
 * none of the lock-wait detection — that scanner runs every couple of
 * minutes against every tracking-enabled machine, so it deliberately
 * skips work it doesn't need rather than reusing collectMachineData and
 * discarding half the result.
 */
export async function collectLongRunningQueriesOnly(
  connection: Pick<DbConnection, "id" | "name" | "host" | "port" | "monitorUsername" | "monitorPasswordEnc">,
  minDurationSeconds: number
): Promise<RunningQuery[]> {
  const { username, password } = resolveMonitorCredentials(connection);

  const conn = await mysql.createConnection({
    host: connection.host,
    port: connection.port,
    user: username,
    password,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });

  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(PROCESSLIST_SQL, [username, minDurationSeconds]);
    return mapProcesslistRows(rows, connection);
  } finally {
    await conn.end().catch(() => undefined);
  }
}

/** Back-compat wrapper for anything that only wants the query list (see scripts/test-collector.ts). */
export async function collectRunningQueries(
  connection: Pick<DbConnection, "id" | "name" | "host" | "port" | "monitorUsername" | "monitorPasswordEnc">,
  opts: { minDurationSeconds?: number } = {}
): Promise<RunningQuery[]> {
  return (await collectMachineData(connection, opts)).queries;
}

/** Runs the collector against every given connection concurrently, merging + re-sorting the results. */
export async function collectAcrossConnections(
  connections: Pick<DbConnection, "id" | "name" | "host" | "port" | "monitorUsername" | "monitorPasswordEnc">[],
  opts: { minDurationSeconds?: number } = {}
): Promise<{
  queries: RunningQuery[];
  lockWaits: LockWait[];
  errors: { connectionId: string; connectionName: string; message: string }[];
}> {
  const settled = await Promise.allSettled(
    connections.map((c) => collectMachineData(c, opts))
  );

  const queries: RunningQuery[] = [];
  const lockWaits: LockWait[] = [];
  const errors: { connectionId: string; connectionName: string; message: string }[] = [];

  settled.forEach((result, i) => {
    const c = connections[i];
    if (result.status === "fulfilled") {
      queries.push(...result.value.queries);
      lockWaits.push(...result.value.lockWaits);
    } else {
      errors.push({
        connectionId: c.id,
        connectionName: c.name,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  // Longest-running first, across all machines combined.
  queries.sort((a, b) => b.durationSeconds - a.durationSeconds);
  // Longest-waiting first — the most urgent lock waits float to the top.
  lockWaits.sort((a, b) => b.waitSeconds - a.waitSeconds);

  return { queries, lockWaits, errors };
}
