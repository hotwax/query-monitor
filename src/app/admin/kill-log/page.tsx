import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import TopBar from "@/components/TopBar";
import KillLogAdmin from "@/components/KillLogAdmin";
import { roleAllows, CAN_REVEAL_KILL_COMMAND } from "@/lib/rbac";

export default async function KillLogPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!roleAllows(session.role, CAN_REVEAL_KILL_COMMAND)) redirect("/dashboard?denied=1");

  return (
    <>
      <TopBar email={session.email} role={session.role} />
      <div className="container">
        <KillLogAdmin />
      </div>
    </>
  );
}
