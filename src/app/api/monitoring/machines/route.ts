import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { awsMonitoringConfigured } from "@/lib/cloudwatch";

// Deliberately lighter than GET /api/connections (which is DEVOPS/ADMIN
// only and returns host/username detail): anyone who can see the
// dashboard should be able to pick a machine on the Monitoring page, so
// this route is only gated by "logged in" (via middleware) and returns
// nothing sensitive — no host, no credentials.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const connections = await prisma.dbConnection.findMany({
    select: { id: true, name: true, isReadReplica: true, awsDbInstanceIdentifier: true },
    orderBy: [{ isReadReplica: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    awsConfigured: awsMonitoringConfigured(),
    machines: connections.map((c) => ({
      id: c.id,
      name: c.name,
      isReadReplica: c.isReadReplica,
      monitoringConfigured: Boolean(c.awsDbInstanceIdentifier),
    })),
  });
}
