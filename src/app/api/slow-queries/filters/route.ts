import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DURATION_CATEGORIES } from "@/lib/slow-query-categories";
import { getSlowQueryMinDurationSeconds } from "@/lib/app-settings";

/**
 * Populates the Query History page's filter dropdowns: every DB Machine
 * that has tracking turned on right now (plus any machine that logged
 * entries in the past, even if tracking was since turned off — the row
 * `connectionName` is captured at write time precisely so old history
 * stays filterable/readable after that), and every distinct database name
 * that has ever shown up in the log.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [machines, loggedConnectionNames, databaseRows, minDurationSeconds] = await Promise.all([
    prisma.dbConnection.findMany({
      where: { slowQueryTrackingEnabled: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.slowQueryLog.findMany({
      distinct: ["connectionName"],
      select: { connectionId: true, connectionName: true },
    }),
    prisma.slowQueryLog.findMany({
      distinct: ["databaseName"],
      select: { databaseName: true },
      where: { databaseName: { not: null } },
      orderBy: { databaseName: "asc" },
    }),
    getSlowQueryMinDurationSeconds(),
  ]);

  // Merge in machines that have history but aren't (or are no longer)
  // tracking-enabled, so past data never becomes unfilterable.
  const machineMap = new Map(machines.map((m) => [m.id, m.name]));
  for (const row of loggedConnectionNames) {
    if (row.connectionId && !machineMap.has(row.connectionId)) {
      machineMap.set(row.connectionId, row.connectionName);
    }
  }
  const allMachines = Array.from(machineMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    machines: allMachines,
    databases: databaseRows.map((r) => r.databaseName).filter((d): d is string => Boolean(d)),
    categories: DURATION_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
    // So the page can describe the floor accurately instead of a hardcoded
    // "30 minutes" — this is now an admin-editable setting, see DB Machines.
    minDurationSeconds,
  });
}
