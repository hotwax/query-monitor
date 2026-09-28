import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import TopBar from "@/components/TopBar";
import QueryDashboard from "@/components/QueryDashboard";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <>
      <TopBar email={session.email} role={session.role} />
      <div className="container">
        {searchParams.denied && (
          <div className="alert warn">
            That page is only available to DevOps/Admin accounts.
          </div>
        )}
        <QueryDashboard role={session.role} />
      </div>
    </>
  );
}
