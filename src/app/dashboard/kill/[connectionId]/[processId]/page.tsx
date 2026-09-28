import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import TopBar from "@/components/TopBar";
import KillCommandPanel from "@/components/KillCommandPanel";
import { roleAllows, CAN_REVEAL_KILL_COMMAND } from "@/lib/rbac";

function param(v: string | string[] | undefined): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

export default async function KillQueryPage({
  params,
  searchParams,
}: {
  params: { connectionId: string; processId: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!roleAllows(session.role, CAN_REVEAL_KILL_COMMAND)) redirect("/dashboard?denied=1");

  const processId = Number(params.processId);
  if (!Number.isFinite(processId)) notFound();

  const connection = await prisma.dbConnection.findUnique({ where: { id: params.connectionId } });
  if (!connection) notFound();

  // Everything below is what the dashboard already knew about this query at
  // the moment you clicked "Kill Query" — carried over via the URL so this
  // page can show full details even if the query has since finished
  // (common for short-lived queries).
  const captured = {
    dbUsername: param(searchParams.dbUsername),
    connectionName: param(searchParams.connectionName),
    database: param(searchParams.database),
    clientHost: param(searchParams.clientHost),
    state: param(searchParams.state),
    queryText: param(searchParams.queryText),
    durationSeconds: (() => {
      const raw = param(searchParams.durationSeconds);
      const n = raw !== null ? Number(raw) : NaN;
      return Number.isFinite(n) ? n : null;
    })(),
  };

  // Step 1 of the event trail: arriving on this page at all. "Checked
  // status" and "killed/failed" are logged from their own actions — see
  // src/app/api/kill-log/route.ts and src/app/api/kill-execute/route.ts.
  await logAudit({
    actorEmail: session.email,
    actorId: session.sub,
    action: "VIEWED_KILL_PAGE",
    connectionId: params.connectionId,
    detail: {
      processId,
      connectionName: connection.name,
      dbUsername: captured.dbUsername,
      database: captured.database,
      queryText: captured.queryText,
    },
  });

  return (
    <>
      <TopBar email={session.email} role={session.role} />
      <div className="container" style={{ maxWidth: 760 }}>
        <KillCommandPanel connectionId={params.connectionId} processId={processId} captured={captured} />
      </div>
    </>
  );
}
