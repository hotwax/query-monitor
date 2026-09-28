import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { awsMonitoringConfigured, fetchMachineMetrics, resolveRegion } from "@/lib/cloudwatch";

// range -> { minutes back, CloudWatch period in seconds }. Kept short so
// each chart stays readable — this mirrors the AWS console's own presets,
// trimmed to the ones actually useful for "is something on fire right
// now" (that's what this page is for; a full historical explorer is a
// separate, later ask if it's ever wanted).
const RANGES: Record<string, { minutes: number; periodSeconds: number }> = {
  "1h": { minutes: 60, periodSeconds: 60 },
  "3h": { minutes: 180, periodSeconds: 60 },
  "12h": { minutes: 720, periodSeconds: 300 },
  "1d": { minutes: 1440, periodSeconds: 300 },
};

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const connectionId = req.nextUrl.searchParams.get("connectionId");
  const rangeParam = req.nextUrl.searchParams.get("range") ?? "1h";
  const range = RANGES[rangeParam];

  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required." }, { status: 400 });
  }
  if (!range) {
    return NextResponse.json({ error: `range must be one of: ${Object.keys(RANGES).join(", ")}` }, { status: 400 });
  }

  if (!awsMonitoringConfigured()) {
    return NextResponse.json({
      configured: false,
      message:
        "AWS monitoring isn't set up yet — add AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION to the app's environment. See README → “AWS CloudWatch monitoring”.",
    });
  }

  const connection = await prisma.dbConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, name: true, awsDbInstanceIdentifier: true, isReadReplica: true, awsRegion: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "No such database machine." }, { status: 404 });
  }
  if (!connection.awsDbInstanceIdentifier) {
    return NextResponse.json({
      configured: false,
      message: `"${connection.name}" doesn't have an AWS RDS DB instance identifier set yet — add one from the DB Machines admin page to enable monitoring for it.`,
    });
  }

  const region = resolveRegion(connection.awsRegion);
  if (!region) {
    return NextResponse.json({
      configured: false,
      message: `"${connection.name}" has no AWS region to query — set AWS_REGION in the app's environment, or (if this machine is in a different region than the rest) set a per-machine region override on the DB Machines admin page.`,
    });
  }

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - range.minutes * 60 * 1000);

  try {
    const metrics = await fetchMachineMetrics({
      dbInstanceIdentifier: connection.awsDbInstanceIdentifier,
      isReadReplica: connection.isReadReplica,
      region,
      startTime,
      endTime,
      periodSeconds: range.periodSeconds,
    });
    return NextResponse.json({
      configured: true,
      connectionName: connection.name,
      isReadReplica: connection.isReadReplica,
      dbInstanceIdentifier: connection.awsDbInstanceIdentifier,
      region,
      range: rangeParam,
      metrics,
    });
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        error: `Could not fetch CloudWatch metrics: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    );
  }
}
