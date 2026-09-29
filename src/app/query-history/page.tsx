import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import TopBar from "@/components/TopBar";
import QueryHistory from "@/components/QueryHistory";

// Same access level as Dashboard/Monitoring — any logged-in role. This is
// a read-only view of what already happened, not an admin action; turning
// tracking on/off per machine is still gated to DEVOPS/ADMIN on DB Machines.
export default async function QueryHistoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <>
      <TopBar email={session.email} role={session.role} />
      <div className="container">
        <QueryHistory />
      </div>
    </>
  );
}
