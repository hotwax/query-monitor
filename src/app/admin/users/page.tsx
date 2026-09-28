import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import TopBar from "@/components/TopBar";
import UsersAdmin from "@/components/UsersAdmin";
import { roleAllows, CAN_MANAGE_USERS } from "@/lib/rbac";

export default async function UsersAdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!roleAllows(session.role, CAN_MANAGE_USERS)) redirect("/dashboard?denied=1");

  return (
    <>
      <TopBar email={session.email} role={session.role} />
      <div className="container">
        <UsersAdmin />
      </div>
    </>
  );
}
