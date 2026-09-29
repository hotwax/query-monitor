import { prisma } from "@/lib/db";
import { collectLongRunningQueriesOnly } from "@/lib/mysql-collector";
import { categorizeDuration, MIN_TRACKED_DURATION_SECONDS } from "@/lib/slow-query-categories";

/**
 * Background recorder for the "Query History" page. Runs entirely inside
 * this Node process — started once from src/instrumentation.ts when the
 * server boots — so it keeps checking every registered, tracking-enabled
 * machine on its own, whether or not anyone has the app open in a
 * browser. That's the whole point: the live Dashboard only ever shows
 * what's running "right now" and keeps nothing once a query finishes;
 * this exists to survive past that moment.
 *
 * Caveat worth knowing if this app is ever run as more than one instance
 * (e.g. scaled horizontally): each instance runs its own copy of this
 * scanner. That's harmless — worst case is a few redundant PROCESSLIST
 * polls — but only one instance's copy is really "needed." Not a concern
 * for the single-container docker-compose setup this app ships with.
 */

const SCAN_INTERVAL_MS = Number(process.env.SLOW_QUERY_SCAN_INTERVAL_MS ?? 120_000); // 2 minutes
const RETENTION_DAYS = Number(process.env.SLOW_QUERY_RETENTION_DAYS ?? 30);
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day is plenty for a 30-day retention window
// If a query we're already tracking as RUNNING shows a duration that drops
// by more than this, it's not the same query slowing down — it's a new,
// unrelated connection that got handed the same recycled PROCESSLIST id.
const PID_REUSE_TOLERANCE_SECONDS = 120;

let lastCleanupAt = 0;
let isTicking = false;

type TrackedConnection = {
  id: string;
  name: string;
  host: string;
  port: number;
  monitorUsername: string | null;
  monitorPasswordEnc: string | null;
};

async function recordOccurrence(connection: TrackedConnection, q: Awaited<ReturnType<typeof collectLongRunningQueriesOnly>>[number]) {
  const category = categorizeDuration(q.durationSeconds);

  const existing = await prisma.slowQueryLog.findFirst({
    where: { connectionId: connection.id, processId: q.processId, status: "RUNNING" },
    orderBy: { lastSeenAt: "desc" },
  });

  const isSameOccurrence = existing && q.durationSeconds >= existing.maxDurationSeconds - PID_REUSE_TOLERANCE_SECONDS;

  if (existing && isSameOccurrence) {
    await prisma.slowQueryLog.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        maxDurationSeconds: Math.max(existing.maxDurationSeconds, q.durationSeconds),
        category,
        queryText: q.queryText ?? existing.queryText,
        databaseName: q.database ?? existing.databaseName,
        dbUsername: q.dbUsername,
        clientHost: q.clientHost ?? existing.clientHost,
      },
    });
    return;
  }

  if (existing && !isSameOccurrence) {
    // The PROCESSLIST id got reused by a different connection — close out
    // the row we had open for the previous occurrence under that id.
    await prisma.slowQueryLog.update({ where: { id: existing.id }, data: { status: "ENDED" } });
  }

  await prisma.slowQueryLog.create({
    data: {
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: q.database,
      dbUsername: q.dbUsername,
      clientHost: q.clientHost,
      queryText: q.queryText,
      processId: q.processId,
      category,
      status: "RUNNING",
      maxDurationSeconds: q.durationSeconds,
    },
  });
}

async function scanConnection(connection: TrackedConnection) {
  let queries;
  try {
    queries = await collectLongRunningQueriesOnly(connection, MIN_TRACKED_DURATION_SECONDS);
  } catch (err) {
    // Fail open — one unreachable machine shouldn't stop the others, and
    // we'll just try this one again on the next tick.
    console.error(`[slow-query-scanner] ${connection.name}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const seenProcessIds: number[] = [];
  for (const q of queries) {
    seenProcessIds.push(q.processId);
    try {
      await recordOccurrence(connection, q);
    } catch (err) {
      console.error(`[slow-query-scanner] ${connection.name} pid ${q.processId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Anything we still have marked RUNNING for this machine that didn't
  // show up in this poll has stopped — either it finished, or something
  // outside this app killed it. We can't tell which, so it's just "ended."
  await prisma.slowQueryLog.updateMany({
    where: {
      connectionId: connection.id,
      status: "RUNNING",
      ...(seenProcessIds.length > 0 ? { processId: { notIn: seenProcessIds } } : {}),
    },
    data: { status: "ENDED" },
  });
}

async function cleanupOldEntries() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.slowQueryLog.deleteMany({ where: { firstDetectedAt: { lt: cutoff } } });
  if (result.count > 0) {
    console.log(`[slow-query-scanner] removed ${result.count} entr${result.count === 1 ? "y" : "ies"} older than ${RETENTION_DAYS} days`);
  }
}

async function tick() {
  if (isTicking) return; // a previous tick is still running (slow/unreachable machine) — skip, try again next interval
  isTicking = true;
  try {
    const connections = await prisma.dbConnection.findMany({
      where: { slowQueryTrackingEnabled: true },
      select: { id: true, name: true, host: true, port: true, monitorUsername: true, monitorPasswordEnc: true },
    });

    await Promise.allSettled(connections.map((c) => scanConnection(c)));

    const now = Date.now();
    if (now - lastCleanupAt > CLEANUP_INTERVAL_MS) {
      lastCleanupAt = now;
      await cleanupOldEntries().catch((err) => console.error("[slow-query-scanner] cleanup failed:", err));
    }
  } catch (err) {
    console.error("[slow-query-scanner] tick failed:", err);
  } finally {
    isTicking = false;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __slowQueryScannerStarted: boolean | undefined;
}

/** Called once from src/instrumentation.ts when the server boots. Safe to call more than once — only the first call actually starts anything. */
export function startSlowQueryScanner() {
  if (globalThis.__slowQueryScannerStarted) return;
  globalThis.__slowQueryScannerStarted = true;

  console.log(`[slow-query-scanner] started — checking tracking-enabled machines every ${SCAN_INTERVAL_MS / 1000}s`);
  // A short delay before the first run, so this isn't racing the rest of
  // the server's own startup (DB connection pool, etc.) at t=0.
  setTimeout(() => void tick(), 5000);
  setInterval(() => void tick(), SCAN_INTERVAL_MS);
}
