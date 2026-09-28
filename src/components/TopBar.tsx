"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Role } from "@/lib/types";

export default function TopBar({ email, role }: { email: string; role: Role }) {
  const router = useRouter();
  const canAdmin = role === "DEVOPS" || role === "ADMIN";
  const canManageUsers = role === "ADMIN";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="topbar">
      <div>
        <span className="brand">Query Monitor</span>
        <span className={`badge role-${role}`} style={{ marginLeft: 10 }}>
          {role}
        </span>
      </div>
      <nav style={{ display: "flex", alignItems: "center" }}>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/monitoring">Monitoring</Link>
        {canAdmin && <Link href="/admin/connections">DB Machines</Link>}
        {canAdmin && <Link href="/admin/kill-log">Kill Log</Link>}
        {canManageUsers && <Link href="/admin/users">Users</Link>}
        <span className="muted" style={{ marginLeft: 18, fontSize: 13 }}>
          {email}
        </span>
        <button className="secondary" style={{ marginLeft: 12 }} onClick={logout}>
          Sign out
        </button>
      </nav>
    </div>
  );
}
