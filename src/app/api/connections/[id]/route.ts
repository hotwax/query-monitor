import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { roleAllows, CAN_MANAGE_CONNECTIONS } from "@/lib/rbac";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_MANAGE_CONNECTIONS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await prisma.dbConnection.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}

// A genuine partial update: only fields actually present in the request
// body are touched. This matters now that two independent controls PATCH
// this same endpoint — the AWS monitoring setup (DB Machines page) and the
// "track slow queries" toggle (also DB Machines page, but a separate
// control) — neither should be able to silently clobber the other back to
// blank/off just because it wasn't part of that particular save.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_MANAGE_CONNECTIONS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if ("awsDbInstanceIdentifier" in body) {
    data.awsDbInstanceIdentifier = body.awsDbInstanceIdentifier || null;
  }
  if ("isReadReplica" in body) {
    data.isReadReplica = Boolean(body.isReadReplica);
  }
  if ("awsRegion" in body) {
    data.awsRegion = body.awsRegion || null;
  }
  if ("slowQueryTrackingEnabled" in body) {
    data.slowQueryTrackingEnabled = Boolean(body.slowQueryTrackingEnabled);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No recognized fields to update." }, { status: 400 });
  }

  const before =
    "slowQueryTrackingEnabled" in data
      ? await prisma.dbConnection.findUnique({ where: { id: params.id }, select: { slowQueryTrackingEnabled: true, name: true } })
      : null;

  const connection = await prisma.dbConnection.update({
    where: { id: params.id },
    data,
  });

  if (before && before.slowQueryTrackingEnabled !== connection.slowQueryTrackingEnabled) {
    await logAudit({
      actorEmail: session.email,
      actorId: session.sub,
      action: connection.slowQueryTrackingEnabled ? "SLOW_QUERY_TRACKING_ENABLED" : "SLOW_QUERY_TRACKING_DISABLED",
      connectionId: connection.id,
      detail: { connectionName: connection.name },
    });
  }

  return NextResponse.json({ id: connection.id });
}
