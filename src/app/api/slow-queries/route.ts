import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { buildSlowQueryWhere } from "@/lib/slow-query-filters";

const PAGE_SIZE = 50;

// Same access level as Dashboard/Monitoring — read-only, any logged-in
// role. Filters are all optional and combine (AND together) when given.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const searchParams = req.nextUrl.searchParams;
  const where = buildSlowQueryWhere(searchParams);

  const pageParam = Number(searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  const [total, items] = await Promise.all([
    prisma.slowQueryLog.count({ where }),
    prisma.slowQueryLog.findMany({
      where,
      orderBy: { firstDetectedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return NextResponse.json({
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
