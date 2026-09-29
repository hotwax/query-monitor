import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { buildSlowQueryWhere } from "@/lib/slow-query-filters";
import { categoryLabel, formatDurationLong } from "@/lib/slow-query-categories";

// A hard cap so one very wide filter (or none at all) can't try to build
// an unbounded workbook in memory. 30-day retention keeps the realistic
// ceiling well under this anyway; this is a backstop, not an expected case.
const EXPORT_ROW_LIMIT = 20_000;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const where = buildSlowQueryWhere(req.nextUrl.searchParams);

  const rows = await prisma.slowQueryLog.findMany({
    where,
    orderBy: { firstDetectedAt: "desc" },
    take: EXPORT_ROW_LIMIT,
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Query Monitor";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Slow Query History");
  sheet.columns = [
    { header: "Detected at", key: "detectedAt", width: 20 },
    { header: "Last seen at", key: "lastSeenAt", width: 20 },
    { header: "Status", key: "status", width: 10 },
    { header: "Machine", key: "connectionName", width: 22 },
    { header: "Database", key: "databaseName", width: 20 },
    { header: "DB user", key: "dbUsername", width: 16 },
    { header: "Client host", key: "clientHost", width: 20 },
    { header: "Category", key: "category", width: 18 },
    { header: "Duration", key: "duration", width: 14 },
    { header: "Duration (seconds)", key: "durationSeconds", width: 16 },
    { header: "Process ID", key: "processId", width: 12 },
    { header: "Query text", key: "queryText", width: 80 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow({
      detectedAt: row.firstDetectedAt,
      lastSeenAt: row.lastSeenAt,
      status: row.status,
      connectionName: row.connectionName,
      databaseName: row.databaseName ?? "",
      dbUsername: row.dbUsername,
      clientHost: row.clientHost ?? "",
      category: categoryLabel(row.category),
      duration: formatDurationLong(row.maxDurationSeconds),
      durationSeconds: row.maxDurationSeconds,
      processId: row.processId,
      queryText: row.queryText ?? "",
    });
  }
  sheet.getColumn("detectedAt").numFmt = "yyyy-mm-dd hh:mm:ss";
  sheet.getColumn("lastSeenAt").numFmt = "yyyy-mm-dd hh:mm:ss";
  sheet.autoFilter = { from: "A1", to: "L1" };

  const buffer = await workbook.xlsx.writeBuffer();

  await logAudit({
    actorEmail: session.email,
    actorId: session.sub,
    action: "SLOW_QUERY_HISTORY_EXPORTED",
    detail: { rowCount: rows.length, filters: Object.fromEntries(req.nextUrl.searchParams.entries()) },
  });

  const filename = `slow-query-history-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
