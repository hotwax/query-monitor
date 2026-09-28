import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { getSession } from "@/lib/session";
import { roleAllows, CAN_MANAGE_CONNECTIONS } from "@/lib/rbac";

// GET is used by the admin "DB Machines" page (full detail, minus secrets).
// Middleware already restricts /api/connections/* to DEVOPS/ADMIN.
export async function GET() {
  const connections = await prisma.dbConnection.findMany({
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      monitorUsername: true,
      killUsername: true,
      killMethod: true,
      killCommandHost: true,
      notes: true,
      awsDbInstanceIdentifier: true,
      isReadReplica: true,
      awsRegion: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ connections });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_MANAGE_CONNECTIONS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const {
    name,
    host,
    port,
    monitorUsername,
    monitorPassword,
    killUsername,
    killPassword,
    killMethod,
    killCommandHost,
    notes,
    awsDbInstanceIdentifier,
    isReadReplica,
    awsRegion,
  } = body ?? {};

  if (!name || !host) {
    return NextResponse.json({ error: "name and host are required." }, { status: 400 });
  }

  // monitorUsername/monitorPassword are optional per-machine overrides — by
  // default a machine is polled with the shared MONITOR_DB_USERNAME /
  // MONITOR_DB_PASSWORD env vars (see src/lib/monitor-credentials.ts). Only
  // set both here if this one instance needs a different read-only user.
  if ((monitorUsername && !monitorPassword) || (!monitorUsername && monitorPassword)) {
    return NextResponse.json(
      { error: "To override the shared monitor credential, provide both monitorUsername and monitorPassword." },
      { status: 400 }
    );
  }

  // Same optional-override pattern for the dedicated kill account — see
  // src/lib/kill-credentials.ts. Most setups leave this blank and rely on
  // the shared KILL_DB_USERNAME / KILL_DB_PASSWORD env vars instead.
  if ((killUsername && !killPassword) || (!killUsername && killPassword)) {
    return NextResponse.json(
      { error: "To override the shared kill account credential, provide both killUsername and killPassword." },
      { status: 400 }
    );
  }

  if (killMethod && killMethod !== "RDS_PROCEDURE" && killMethod !== "DIRECT_KILL") {
    return NextResponse.json(
      { error: 'killMethod must be "RDS_PROCEDURE" or "DIRECT_KILL".' },
      { status: 400 }
    );
  }

  const connection = await prisma.dbConnection.create({
    data: {
      name,
      host,
      port: port ? Number(port) : 3306,
      monitorUsername: monitorUsername || null,
      monitorPasswordEnc: monitorPassword ? encryptSecret(monitorPassword) : null,
      killUsername: killUsername || null,
      killPasswordEnc: killPassword ? encryptSecret(killPassword) : null,
      killMethod: killMethod || "RDS_PROCEDURE",
      killCommandHost: killCommandHost || null,
      notes: notes || null,
      awsDbInstanceIdentifier: awsDbInstanceIdentifier || null,
      isReadReplica: Boolean(isReadReplica),
      awsRegion: awsRegion || null,
    },
  });

  return NextResponse.json({ id: connection.id }, { status: 201 });
}
