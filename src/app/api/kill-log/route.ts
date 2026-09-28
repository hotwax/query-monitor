import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { roleAllows, CAN_REVEAL_KILL_COMMAND } from "@/lib/rbac";

const MAX_TEXT_LEN = 2000;
const LOGGABLE_ACTIONS = ["CHECKED_STATUS"] as const;

function clamp(v: unknown, max = MAX_TEXT_LEN): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v.length > max ? v.slice(0, max) + "…" : v;
}

/**
 * POST: records one step of the Kill Query event trail that isn't already
 * logged elsewhere — currently just "Check current status" clicks (page
 * views are logged server-side when the kill page renders; the kill itself
 * is logged by /api/kill-execute). See src/lib/audit.ts for the full set
 * of actions and where each is written.
 *
 * GET: lists recent kill-related audit entries for the Kill Log admin page.
 * Same role gate as everything else on the Kill Query page — if you can't
 * kill a query, you can't view who did.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !roleAllows(session.role, CAN_REVEAL_KILL_COMMAND)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const action = LOGGABLE_ACTIONS.includes(body?.action) ? body.action : null;
    const connectionId = typeof body?.connectionId === "string" ? body.connectionId : null;
    const processId = Number(body?.processId);

    if (!action || !connectionId || !Number.isFinite(processId)) {
      return NextResponse.json({ error: "action, connectionId, and processId are required." }, { status: 400 });
    }

    const connection = await prisma.dbConnection.findUnique({ where: { id: connectionId } });
    if (!connection) {
      return NextResponse.json({ error: "Unknown database machine." }, { status: 404 });
    }

    await logAudit({
      actorEmail: session.email,
      actorId: session.sub,
      action,
      connectionId,
      detail: {
        processId,
        connectionName: connection.name,
        running: typeof body?.running === "boolean" ? body.running : null,
        dbUsername: clamp(body?.dbUsername, 200),
        database: clamp(body?.database, 200),
        queryText: clamp(body?.queryText),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[kill-log] Unexpected error while recording an event:", err);
    return NextResponse.json({ error: "Unexpected server error while logging this." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_REVEAL_KILL_COMMAND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 50), 1), 200);
  const before = req.nextUrl.searchParams.get("before"); // an AuditLog id, for "load more"

  const cursor = before ? { id: before } : undefined;

  const entries = await prisma.auditLog.findMany({
    where: {
      action: {
        in: [
          "VIEWED_KILL_PAGE",
          "CHECKED_STATUS",
          "KILL_EXECUTED",
          "KILL_FAILED",
          // Legacy actions from the earlier reveal-a-command design —
          // still shown so old history isn't lost.
          "REVEAL_KILL_COMMAND",
          "CONFIRMED_KILL",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    ...(cursor ? { cursor, skip: 1 } : {}),
    select: {
      id: true,
      actorEmail: true,
      action: true,
      detail: true,
      createdAt: true,
      connection: { select: { name: true } },
    },
  });

  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      actorEmail: e.actorEmail,
      action: e.action,
      connectionName: e.connection?.name ?? null,
      detail: e.detail ? JSON.parse(e.detail) : null,
      createdAt: e.createdAt,
    })),
    nextCursor: entries.length === limit ? entries[entries.length - 1].id : null,
  });
}
