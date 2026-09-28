"use client";

import { useEffect, useState, useCallback } from "react";
import type { Role } from "@/lib/types";

interface UserRow {
  id: string;
  username: string;
  name: string;
  email: string;
  role: Role;
  status: "INVITED" | "ACTIVE" | "DISABLED";
  mfaEnabled: boolean;
  createdAt: string;
}

const emptyForm = { username: "", name: "", email: "", role: "DEVELOPER" as Role };

export default function UsersAdmin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/users");
    const data = await res.json();
    setUsers(data.users ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create user.");
        return;
      }
      setForm(emptyForm);
      setNotice(`Invite sent to ${form.email}.`);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(user: UserRow) {
    setBusyId(user.id);
    setError(null);
    try {
      const action = user.status === "DISABLED" ? "enable" : "disable";
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not update this user.");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function resendInvite(user: UserRow) {
    setBusyId(user.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/users/${user.id}/resend-invite`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not resend the invite.");
        return;
      }
      setNotice(`Invite resent to ${user.email}.`);
    } finally {
      setBusyId(null);
    }
  }

  async function resetMfa(user: UserRow) {
    if (!confirm(`Reset MFA for ${user.name}? They'll have to set up a new authenticator app on their next login.`)) return;
    setBusyId(user.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-mfa`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not reset MFA for this user.");
        return;
      }
      setNotice(`MFA reset for ${user.name} — they'll set up a new authenticator app next time they log in.`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20 }}>
      <div className="card">
        <p className="section-title">Users</p>
        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert ok">{notice}</div>}
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>MFA</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.name}</td>
                <td className="muted">{u.email}</td>
                <td>
                  <span className={`badge role-${u.role}`}>{u.role}</span>
                </td>
                <td className="muted">{u.status}</td>
                <td className="muted">{u.mfaEnabled ? "✓ enabled" : "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {u.status === "INVITED" && (
                      <button className="secondary" disabled={busyId === u.id} onClick={() => resendInvite(u)}>
                        Resend invite
                      </button>
                    )}
                    {u.status !== "INVITED" && (
                      <button className="secondary" disabled={busyId === u.id} onClick={() => toggleStatus(u)}>
                        {u.status === "DISABLED" ? "Enable" : "Disable"}
                      </button>
                    )}
                    {u.status !== "INVITED" && u.mfaEnabled && (
                      <button className="secondary" disabled={busyId === u.id} onClick={() => resetMfa(u)}>
                        Reset MFA
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <p className="section-title">Invite a user</p>
        <form onSubmit={submit}>
          <div className="field">
            <label>Username</label>
            <input
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              style={{ width: "100%" }}
            />
          </div>
          <div className="field">
            <label>Name</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={{ width: "100%" }}
            />
          </div>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              style={{ width: "100%" }}
            />
          </div>
          <div className="field">
            <label>Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} style={{ width: "100%" }}>
              <option value="DEVELOPER">Developer</option>
              <option value="DEVOPS">DevOps</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 14 }}>
            An invite email is sent immediately. They&apos;ll set their own password and MFA app when they
            accept it — no password is set here.
          </p>
          <button type="submit" disabled={saving} style={{ width: "100%" }}>
            {saving ? "Sending invite…" : "Send invite"}
          </button>
        </form>
      </div>
    </div>
  );
}
