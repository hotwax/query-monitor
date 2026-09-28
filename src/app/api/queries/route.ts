import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { collectAcrossConnections } from "@/lib/mysql-collector";
import { getSession } from "@/lib/session";

// Note: this endpoint is polled every few seconds by the dashboard, so it is
// deliberately NOT written to the audit log on every call (that would flood
// it) — only LOGIN and REVEAL_KILL_COMMAND (which exposes a live password)
// are audited. See README "Audit logging" if you want query views logged
// too (e.g. sampled, or once per session).
const DEFAULT_THRESHOLD = Number(process.env.LONG_QUERY_THRESHOLD_SECONDS ?? 5);

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const connectionId = req.nextUrl.searchParams.get("connectionId");
  const minDuration = Number(req.nextUrl.searchParams.get("minDuration") ?? DEFAULT_THRESHOLD);

  const connections = await prisma.dbConnection.findMany({
    where: connectionId ? { id: connectionId } : undefined,
    select: { id: true, name: true, host: true, port: true, monitorUsername: true, monitorPasswordEnc: true },
  });

  if (connections.length === 0) {
    return NextResponse.json({ queries: [], lockWaits: [], errors: [], machineCount: 0 });
  }

  const { queries, lockWaits, errors } = await collectAcrossConnections(connections, { minDurationSeconds: minDuration });

  return NextResponse.json({
    queries,
    lockWaits,
    errors,
    machineCount: connections.length,
    // Lets the dashboard split one fetch into a "long-running" highlight
    // section and a full "all running queries" section without needing a
    // second request or a hardcoded threshold on the client.
    longQueryThresholdSeconds: DEFAULT_THRESHOLD,
  });
}
