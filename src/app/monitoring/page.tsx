import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import TopBar from "@/components/TopBar";
import MonitoringDashboard from "@/components/MonitoringDashboard";

// Same access level as the main Dashboard (any logged-in role) — this is a
// read-only view, not an admin action, so it isn't gated by
// CAN_MANAGE_CONNECTIONS the way the DB Machines page is.
export default async function MonitoringPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <>
      <TopBar email={session.email} role={session.role} />
      <div className="container">
        <MonitoringDashboard />
      </div>
    </>
  );
}
