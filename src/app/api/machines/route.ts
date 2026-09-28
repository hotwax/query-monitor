import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Without this, Next.js statically optimizes this handler at build time
// (it reads no cookies/headers) and would keep serving whatever the DB
// contained at build time forever, ignoring machines added later.
export const dynamic = "force-dynamic";

/** Lightweight list for the dashboard's machine selector — no credentials, available to any logged-in role. */
export async function GET() {
  const connections = await prisma.dbConnection.findMany({
    select: { id: true, name: true, host: true, port: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ connections });
}
