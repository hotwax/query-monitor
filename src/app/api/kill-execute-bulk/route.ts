import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { roleAllows, CAN_REVEAL_KILL_COMMAND } from "@/lib/rbac";
import { killProcess, clamp, type KillResult } from "@/lib/kill-process";

// Not a hard product requirement — just a sanity backstop against a
// pathological request (e.g. a bug sending the same selection twice). The
// Dashboard's bulk-select is meant for a handful to a few dozen queries at
// a time; this just keeps one request from trying to march through
// hundreds of kills unattended.
const MAX_BATCH = 100;

interface BulkRequestItem {
  processId: number;
  dbUsername: string | null;
  database: string | null;
  queryText: string | null;
}

/**
 * Kills several processes on ONE machine in a single request — the
 * Dashboard's "Kill N Queries" bulk action. Scoped to one connection
 * deliberately: the Dashboard only ever shows/selects queries for whichever
 * machine is currently chosen in the dropdown, so there is never a mixed
 * batch spanning machines to worry about here.
 *
 * Loops through the batch SEQUENTIALLY, calling the same src/lib/kill-process.ts
 * used by the single-query /api/kill-execute route for every item — same
 * live pre-kill safety check, same audit trail, one row per process either
 * way. A failure on one item (already finished, a protected system account,
 * a transient connection error) does not stop the rest of the batch from
 * being attempted; the full per-item outcome comes back in `results` for
 * the UI to show individually.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_REVEAL_KILL_COMMAND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const connectionId = typeof body?.connectionId === "string" ? body.connectionId : null;
  const rawProcesses = Array.isArray(body?.processes) ? body.processes : [];

  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required." }, { status: 400 });
  }
  if (rawProcesses.length === 0) {
    return NextResponse.json({ error: "At least one process is required." }, { status: 400 });
  }
  if (rawProcesses.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Refusing to kill more than ${MAX_BATCH} queries in a single bulk action.` },
      { status: 400 }
    );
  }

  const items: BulkRequestItem[] = [];
  for (const raw of rawProcesses) {
    const processId = Number(raw?.processId);
    if (!Number.isFinite(processId)) {
      return NextResponse.json({ error: "Every process requires a numeric processId." }, { status: 400 });
    }
    items.push({
      processId,
      dbUsername: clamp(raw?.dbUsername, 200),
      database: clamp(raw?.database, 200),
      queryText: clamp(raw?.queryText),
    });
  }

  const connection = await prisma.dbConnection.findUnique({ where: { id: connectionId } });
  if (!connection) {
    return NextResponse.json({ error: "Unknown database machine." }, { status: 404 });
  }

  // Sequential, not parallel: every item here hits the SAME database
  // instance, so running them one after another keeps this predictable
  // (results arrive in a stable order) and avoids opening a burst of
  // simultaneous kill-account connections against production for a large
  // batch. For the batch sizes this feature targets, total time stays well
  // within a normal request timeout.
  const results: KillResult[] = [];
  for (const item of items) {
    const result = await killProcess({
      connection,
      processId: item.processId,
      actorEmail: session.email,
      actorId: session.sub,
      captured: { dbUsername: item.dbUsername, database: item.database, queryText: item.queryText },
      bulk: true,
    });
    results.push(result);
  }

  return NextResponse.json({ connectionName: connection.name, results });
}
