import type { Prisma } from "@prisma/client";
import { isDurationCategory } from "@/lib/slow-query-categories";

/**
 * Shared between GET /api/slow-queries (the paginated list) and
 * GET /api/slow-queries/export (the Excel download) so both always apply
 * exactly the same filters — kept out of either route file since Next's App
 * Router route handlers only allow a fixed set of exports (GET/POST/etc +
 * a couple of config values), not arbitrary helper exports.
 */
export function buildSlowQueryWhere(searchParams: URLSearchParams): Prisma.SlowQueryLogWhereInput {
  const where: Prisma.SlowQueryLogWhereInput = {};

  const connectionId = searchParams.get("connectionId");
  if (connectionId) where.connectionId = connectionId;

  const databaseName = searchParams.get("databaseName");
  if (databaseName) where.databaseName = databaseName;

  const category = searchParams.get("category");
  if (category && isDurationCategory(category)) where.category = category;

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from || to) {
    where.firstDetectedAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  return where;
}
