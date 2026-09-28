import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { roleAllows, CAN_MANAGE_CONNECTIONS } from "@/lib/rbac";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_MANAGE_CONNECTIONS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await prisma.dbConnection.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}

// Deliberately narrow: only the two AWS CloudWatch monitoring fields are
// editable here (for machines registered before the Monitoring page
// existed, or to fix a typo). Everything else about a DB Machine (host,
// credentials, kill method) is create-once/delete-and-recreate, unchanged
// by this feature.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_MANAGE_CONNECTIONS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const { awsDbInstanceIdentifier, isReadReplica, awsRegion } = body ?? {};

  const connection = await prisma.dbConnection.update({
    where: { id: params.id },
    data: {
      awsDbInstanceIdentifier: awsDbInstanceIdentifier || null,
      isReadReplica: Boolean(isReadReplica),
      awsRegion: awsRegion || null,
    },
  });

  return NextResponse.json({ id: connection.id });
}
