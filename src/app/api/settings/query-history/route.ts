import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { roleAllows, CAN_MANAGE_CONNECTIONS } from "@/lib/rbac";
import { getSlowQueryMinDurationSeconds, setSlowQueryMinDurationSeconds } from "@/lib/app-settings";

// Anyone signed in can see the current floor (the Query History page shows
// it in its description), but only DEVOPS/ADMIN — same bar as everything
// else on the DB Machines page — can change it.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const slowQueryMinDurationSeconds = await getSlowQueryMinDurationSeconds();
  return NextResponse.json({ slowQueryMinDurationSeconds });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !roleAllows(session.role, CAN_MANAGE_CONNECTIONS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const raw = body?.slowQueryMinDurationSeconds;
  const seconds = Number(raw);

  // Sanity bounds: 0 would record literally every query ever seen (never
  // useful — that's what the live Dashboard is for), and an absurdly large
  // value is almost certainly a unit mistake (e.g. minutes typed into a
  // seconds field). Generous on both ends since this is an internal tool,
  // but not unbounded.
  if (!Number.isFinite(seconds) || seconds < 10 || seconds > 24 * 60 * 60) {
    return NextResponse.json(
      { error: "slowQueryMinDurationSeconds must be a number of seconds between 10 and 86400 (24 hours)." },
      { status: 400 }
    );
  }

  const before = await getSlowQueryMinDurationSeconds();
  const saved = await setSlowQueryMinDurationSeconds(Math.round(seconds));

  if (before !== saved) {
    await logAudit({
      actorEmail: session.email,
      actorId: session.sub,
      action: "SLOW_QUERY_MIN_DURATION_CHANGED",
      detail: { fromSeconds: before, toSeconds: saved },
    });
  }

  return NextResponse.json({ slowQueryMinDurationSeconds: saved });
}
