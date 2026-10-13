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
      {/* Full width (no 1180px cap): the query tables have many columns plus
          a text column that wants all the horizontal room it can get, so
          they shouldn't be squeezed into a centered column with empty space
          on both sides of a wide screen. */}
      <div className="container" style={{ maxWidth: "none" }}>
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
