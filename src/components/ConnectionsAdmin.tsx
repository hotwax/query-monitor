"use client";

import { useEffect, useState, useCallback } from "react";

interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  monitorUsername: string | null;
  killUsername: string | null;
  killMethod: string;
  killCommandHost: string | null;
  notes: string | null;
  awsDbInstanceIdentifier: string | null;
  isReadReplica: boolean;
  awsRegion: string | null;
  slowQueryTrackingEnabled: boolean;
}

const emptyForm = {
  name: "",
  host: "",
  port: "3306",
  monitorUsername: "",
  monitorPassword: "",
  killUsername: "",
  killPassword: "",
  killMethod: "RDS_PROCEDURE",
  killCommandHost: "",
  notes: "",
  awsDbInstanceIdentifier: "",
  isReadReplica: false,
  awsRegion: "",
};

export default function ConnectionsAdmin() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingAwsId, setEditingAwsId] = useState<string | null>(null);
  const [awsEditForm, setAwsEditForm] = useState({ awsDbInstanceIdentifier: "", isReadReplica: false, awsRegion: "" });
  const [togglingTrackingId, setTogglingTrackingId] = useState<string | null>(null);

  // "Minimum duration to track" (Query History floor) — a single app-wide
  // setting stored in the database (see src/lib/app-settings.ts), edited
  // here as whole minutes for readability even though it's stored/consumed
  // in seconds everywhere else.
  const [minDurationMinutes, setMinDurationMinutes] = useState<string>("30");
  const [minDurationSaving, setMinDurationSaving] = useState(false);
  const [minDurationError, setMinDurationError] = useState<string | null>(null);
  const [minDurationSaved, setMinDurationSaved] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/connections");
    const data = await res.json();
    setConnections(data.connections ?? []);
  }, []);

  const loadMinDuration = useCallback(async () => {
    const res = await fetch("/api/settings/query-history");
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.slowQueryMinDurationSeconds === "number") {
      setMinDurationMinutes(String(Math.round(data.slowQueryMinDurationSeconds / 60)));
    }
  }, []);

  useEffect(() => {
    load();
    loadMinDuration();
  }, [load, loadMinDuration]);

  async function saveMinDuration(e: React.FormEvent) {
    e.preventDefault();
    setMinDurationSaving(true);
    setMinDurationError(null);
    setMinDurationSaved(false);
    try {
      const minutes = Number(minDurationMinutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        setMinDurationError("Enter a whole number of minutes greater than 0.");
        return;
      }
      const res = await fetch("/api/settings/query-history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slowQueryMinDurationSeconds: Math.round(minutes * 60) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMinDurationError(data.error ?? "Could not save.");
        return;
      }
      setMinDurationMinutes(String(Math.round(data.slowQueryMinDurationSeconds / 60)));
      setMinDurationSaved(true);
    } finally {
      setMinDurationSaving(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setForm(emptyForm);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this database machine?")) return;
    await fetch(`/api/connections/${id}`, { method: "DELETE" });
    await load();
  }

  function startEditAws(c: Connection) {
    setEditingAwsId(c.id);
    setAwsEditForm({
      awsDbInstanceIdentifier: c.awsDbInstanceIdentifier ?? "",
      isReadReplica: c.isReadReplica,
      awsRegion: c.awsRegion ?? "",
    });
  }

  async function saveAws(id: string) {
    await fetch(`/api/connections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(awsEditForm),
    });
    setEditingAwsId(null);
    await load();
  }

  async function toggleSlowQueryTracking(id: string, next: boolean) {
    setTogglingTrackingId(id);
    try {
      await fetch(`/api/connections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slowQueryTrackingEnabled: next }),
      });
      await load();
    } finally {
      setTogglingTrackingId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card">
        <p className="section-title">Query History settings</p>
        <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12, maxWidth: 640 }}>
          How long a query has to run before it&apos;s recorded permanently in Query History (see
          the Query History nav page). Applies to every machine with tracking turned on below.
          Saving here takes effect on the very next background scan — no restart needed.
        </p>
        {minDurationError && <div className="alert error">{minDurationError}</div>}
        <form onSubmit={saveMinDuration} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Minimum duration to track (minutes)</label>
            <input
              type="number"
              min={1}
              value={minDurationMinutes}
              onChange={(e) => {
                setMinDurationMinutes(e.target.value);
                setMinDurationSaved(false);
              }}
              style={{ width: 140 }}
            />
          </div>
          <button type="submit" disabled={minDurationSaving}>
            {minDurationSaving ? "Saving…" : "Save"}
          </button>
          {minDurationSaved && !minDurationSaving && (
            <span className="muted" style={{ fontSize: 12 }}>
              Saved — the scanner will use this from its next cycle.
            </span>
          )}
        </form>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 20, alignItems: "start" }}>
      <div className="card">
        <p className="section-title">Registered database machines</p>
        <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
          &quot;Query History&quot; turns on the permanent slow-query log for that machine (see the
          Query History nav page) — off by default for every machine, including ones registered
          before this feature existed. Checked every ~2 minutes in the background once on.
        </p>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Host</th>
              <th>Monitor user</th>
              <th>Kill account</th>
              <th>Kill method</th>
              <th>AWS monitoring</th>
              <th>Query History</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {connections.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">
                  {c.host}:{c.port}
                </td>
                <td>
                  {c.monitorUsername ?? <span className="muted">(shared env credential)</span>}
                </td>
                <td>
                  {c.killUsername ?? <span className="muted">(shared env credential)</span>}
                </td>
                <td className="muted">{c.killMethod === "DIRECT_KILL" ? "Direct KILL" : "RDS procedure"}</td>
                <td>
                  {editingAwsId === c.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
                      <input
                        value={awsEditForm.awsDbInstanceIdentifier}
                        onChange={(e) =>
                          setAwsEditForm({ ...awsEditForm, awsDbInstanceIdentifier: e.target.value })
                        }
                        placeholder="RDS DB instance identifier"
                      />
                      <input
                        value={awsEditForm.awsRegion}
                        onChange={(e) => setAwsEditForm({ ...awsEditForm, awsRegion: e.target.value })}
                        placeholder="Region override (blank = use AWS_REGION)"
                      />
                      <label style={{ fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={awsEditForm.isReadReplica}
                          onChange={(e) => setAwsEditForm({ ...awsEditForm, isReadReplica: e.target.checked })}
                        />{" "}
                        Read replica
                      </label>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => saveAws(c.id)}>Save</button>
                        <button className="secondary" onClick={() => setEditingAwsId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : c.awsDbInstanceIdentifier ? (
                    <span>
                      {c.awsDbInstanceIdentifier}
                      {c.isReadReplica && <span className="muted"> (replica)</span>}
                      <br />
                      <span className="muted" style={{ fontSize: 12 }}>
                        {c.awsRegion ? `region: ${c.awsRegion}` : "region: AWS_REGION default"}
                      </span>
                      <br />
                      <button className="secondary" style={{ marginTop: 4 }} onClick={() => startEditAws(c)}>
                        Edit
                      </button>
                    </span>
                  ) : (
                    <span>
                      <span className="muted">Not configured</span>
                      <br />
                      <button className="secondary" style={{ marginTop: 4 }} onClick={() => startEditAws(c)}>
                        Set up
                      </button>
                    </span>
                  )}
                </td>
                <td>
                  <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={c.slowQueryTrackingEnabled}
                      disabled={togglingTrackingId === c.id}
                      onChange={(e) => toggleSlowQueryTracking(c.id, e.target.checked)}
                    />
                    {c.slowQueryTrackingEnabled ? "On" : "Off"}
                  </label>
                </td>
                <td>
                  <button className="secondary" onClick={() => remove(c.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {connections.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No database machines registered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <p className="section-title">Add a database machine</p>
        {error && <div className="alert error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Alias</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="prod-orders-mysql"
              style={{ width: "100%" }}
            />
          </div>
          <div className="field">
            <label>Host</label>
            <input
              required
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
              placeholder="orders-db.xxxx.rds.amazonaws.com"
              style={{ width: "100%" }}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              The host this app connects to (use <code>host.docker.internal</code> for local Docker testing).
            </p>
          </div>
          <div className="field">
            <label>Port</label>
            <input
              value={form.port}
              onChange={(e) => setForm({ ...form, port: e.target.value })}
              style={{ width: "100%" }}
            />
          </div>
          <div className="field">
            <label>Read-only monitor username (optional override)</label>
            <input
              value={form.monitorUsername}
              onChange={(e) => setForm({ ...form, monitorUsername: e.target.value })}
              placeholder="leave blank to use MONITOR_DB_USERNAME"
              style={{ width: "100%" }}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Leave blank to use the shared <code>MONITOR_DB_USERNAME</code>/<code>PASSWORD</code>.
            </p>
          </div>
          <div className="field">
            <label>Read-only monitor password (optional override)</label>
            <input
              type="password"
              value={form.monitorPassword}
              onChange={(e) => setForm({ ...form, monitorPassword: e.target.value })}
              placeholder="leave blank to use MONITOR_DB_PASSWORD"
              style={{ width: "100%" }}
            />
          </div>
          <div className="field">
            <label>Kill account username (optional override)</label>
            <input
              value={form.killUsername}
              onChange={(e) => setForm({ ...form, killUsername: e.target.value })}
              placeholder="leave blank to use KILL_DB_USERNAME"
              style={{ width: "100%" }}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Leave blank to use the shared <code>KILL_DB_USERNAME</code>/<code>PASSWORD</code>.
            </p>
          </div>
          <div className="field">
            <label>Kill account password (optional override)</label>
            <input
              type="password"
              value={form.killPassword}
              onChange={(e) => setForm({ ...form, killPassword: e.target.value })}
              placeholder="leave blank to use KILL_DB_PASSWORD"
              style={{ width: "100%" }}
            />
          </div>
          <div className="field">
            <label>Kill method</label>
            <select
              value={form.killMethod}
              onChange={(e) => setForm({ ...form, killMethod: e.target.value })}
              style={{ width: "100%" }}
            >
              <option value="RDS_PROCEDURE">RDS/Aurora procedure (mysql.rds_kill) — default</option>
              <option value="DIRECT_KILL">Direct KILL (self-managed MySQL/MariaDB with CONNECTION_ADMIN/SUPER)</option>
            </select>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Use the default unless this is a self-managed instance with CONNECTION_ADMIN/SUPER granted directly.
            </p>
          </div>
          <div className="field">
            <label>Kill-command host (unused, kept for compatibility)</label>
            <input
              value={form.killCommandHost}
              onChange={(e) => setForm({ ...form, killCommandHost: e.target.value })}
              placeholder="not used anymore — leave blank"
              style={{ width: "100%" }}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Not read anywhere — safe to leave blank.
            </p>
          </div>
          <div className="field">
            <label>Notes (optional)</label>
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              style={{ width: "100%" }}
            />
          </div>
          <div className="field">
            <label>AWS RDS DB instance identifier (optional)</label>
            <input
              value={form.awsDbInstanceIdentifier}
              onChange={(e) => setForm({ ...form, awsDbInstanceIdentifier: e.target.value })}
              placeholder="e.g. oms-prod — as shown in the RDS console"
              style={{ width: "100%" }}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Enables this machine on the Monitoring page — leave blank to add later.
            </p>
          </div>
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={form.isReadReplica}
                onChange={(e) => setForm({ ...form, isReadReplica: e.target.checked })}
              />{" "}
              This is a read replica
            </label>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Shows Replica Lag first on the Monitoring page.
            </p>
          </div>
          <div className="field">
            <label>AWS region override (optional)</label>
            <input
              value={form.awsRegion}
              onChange={(e) => setForm({ ...form, awsRegion: e.target.value })}
              placeholder="leave blank to use the app-wide AWS_REGION"
              style={{ width: "100%" }}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Only needed if this machine is in a different region than the app-wide <code>AWS_REGION</code>.
            </p>
          </div>
          <button type="submit" disabled={saving} style={{ width: "100%" }}>
            {saving ? "Saving…" : "Add machine"}
          </button>
        </form>
      </div>
      </div>
    </div>
  );
}
