import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import TopBar from "@/components/TopBar";
import ConnectionsAdmin from "@/components/ConnectionsAdmin";
import { roleAllows, CAN_MANAGE_CONNECTIONS } from "@/lib/rbac";

export default async function ConnectionsAdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!roleAllows(session.role, CAN_MANAGE_CONNECTIONS)) redirect("/dashboard?denied=1");

  return (
    <>
      <TopBar email={session.email} role={session.role} />
      <div className="container">
        <ConnectionsAdmin />
      </div>
    </>
  );
}
