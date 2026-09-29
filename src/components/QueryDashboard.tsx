"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import type { Role } from "@/lib/types";

interface Machine {
  id: string;
  name: string;
  host: string;
  port: number;
}

interface RunningQuery {
  connectionId: string;
  connectionName: string;
  processId: number;
  dbUsername: string;
  clientHost: string | null;
  database: string | null;
  command: string;
  durationSeconds: number;
  state: string | null;
  queryText: string | null;
}

interface LockWait {
  connectionId: string;
  connectionName: string;
  waitingPid: number;
  waitingQuery: string | null;
  waitingDbUsername: string | null;
  waitingClientHost: string | null;
  waitingDatabase: string | null;
  waitSeconds: number;
  blockingPid: number;
  blockingQuery: string | null;
  blockingDbUsername: string | null;
  blockingClientHost: string | null;
  blockingDatabase: string | null;
}

const DEFAULT_THRESHOLD = 5;
const REFRESH_STORAGE_KEY = "queryMonitor.refreshIntervalMs";
const DEFAULT_INTERVAL_MS = 10000;
const REFRESH_OPTIONS = [
  { label: "Off (manual only)", value: 0 },
  { label: "Every 5s", value: 5000 },
  { label: "Every 10s", value: 10000 },
  { label: "Every 30s", value: 30000 },
  { label: "Every 1m", value: 60000 },
];

function durationClass(seconds: number): string {
  if (seconds >= 60) return "duration-hot";
  if (seconds >= 15) return "duration-warm";
  return "duration-cool";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

/** Carries what the dashboard already knows about this session into the
 * kill page, so that page can show full details and build a command
 * WITHOUT needing the query to still be live by the time you get there —
 * short queries (10-15s) routinely finish before you finish clicking
 * through, and a blocking session is very often idle (see below). */
function killHref(params: {
  connectionId: string;
  connectionName: string;
  processId: number;
  dbUsername: string | null;
  database: string | null;
  clientHost: string | null;
  state: string | null;
  queryText: string | null;
  durationSeconds: number | null;
}): string {
  const q = new URLSearchParams({
    dbUsername: params.dbUsername ?? "",
    connectionName: params.connectionName,
    database: params.database ?? "",
    clientHost: params.clientHost ?? "",
    state: params.state ?? "",
    queryText: params.queryText ?? "",
    durationSeconds: params.durationSeconds != null ? String(params.durationSeconds) : "",
  });
  return `/dashboard/kill/${params.connectionId}/${params.processId}?${q.toString()}`;
}

function QueryTable({
  queries,
  canKill,
  emptyMessage,
}: {
  queries: RunningQuery[];
  canKill: boolean;
  emptyMessage: string;
}) {
  if (queries.length === 0) {
    return <p className="muted">{emptyMessage}</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Duration</th>
          <th>Machine</th>
          <th>Database</th>
          <th>DB user</th>
          <th>Client host</th>
          <th>State</th>
          <th>Query</th>
          {canKill && <th></th>}
        </tr>
      </thead>
      <tbody>
        {queries.map((q) => (
          <tr key={`${q.connectionId}-${q.processId}`}>
            <td className={durationClass(q.durationSeconds)}>{formatDuration(q.durationSeconds)}</td>
            <td>{q.connectionName}</td>
            <td>{q.database ?? <span className="muted">—</span>}</td>
            <td>{q.dbUsername}</td>
            <td className="muted">{q.clientHost ?? "—"}</td>
            <td className="muted">{q.state ?? q.command}</td>
            <td className="query-text">{q.queryText ?? <span className="muted">(no text captured)</span>}</td>
            {canKill && (
              <td>
                <Link
                  className="btn danger"
                  href={killHref({
                    connectionId: q.connectionId,
                    connectionName: q.connectionName,
                    processId: q.processId,
                    dbUsername: q.dbUsername,
                    database: q.database,
                    clientHost: q.clientHost,
                    state: q.state,
                    queryText: q.queryText,
                    durationSeconds: q.durationSeconds,
                  })}
                >
                  Kill Query
                </Link>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LockWaitTable({ lockWaits, canKill }: { lockWaits: LockWait[]; canKill: boolean }) {
  if (lockWaits.length === 0) {
    return <p className="muted">No blocked queries right now. 🎉</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Waiting</th>
          <th>Machine</th>
          <th>Blocking session</th>
          <th>Waiting session</th>
          {canKill && <th></th>}
        </tr>
      </thead>
      <tbody>
        {lockWaits.map((lw) => (
          <tr key={`${lw.connectionId}-${lw.blockingPid}-${lw.waitingPid}`}>
            <td className={durationClass(lw.waitSeconds)}>{formatDuration(lw.waitSeconds)}</td>
            <td>{lw.connectionName}</td>
            <td>
              <div style={{ marginBottom: 4 }}>
                <strong>#{lw.blockingPid}</strong> · {lw.blockingDbUsername ?? <span className="muted">unknown user</span>}
                {lw.blockingDatabase ? <> · {lw.blockingDatabase}</> : null}
              </div>
              {lw.blockingQuery ? (
                <div className="query-text">{lw.blockingQuery}</div>
              ) : (
                <span className="muted">
                  (idle — no statement running, but the transaction is still open and holding the lock)
                </span>
              )}
            </td>
            <td>
              <div style={{ marginBottom: 4 }}>
                <strong>#{lw.waitingPid}</strong> · {lw.waitingDbUsername ?? <span className="muted">unknown user</span>}
                {lw.waitingDatabase ? <> · {lw.waitingDatabase}</> : null}
              </div>
              {lw.waitingQuery ? (
                <div className="query-text">{lw.waitingQuery}</div>
              ) : (
                <span className="muted">(no statement text captured)</span>
              )}
            </td>
            {canKill && (
              <td>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Link
                    className="btn danger"
                    href={killHref({
                      connectionId: lw.connectionId,
                      connectionName: lw.connectionName,
                      processId: lw.blockingPid,
                      dbUsername: lw.blockingDbUsername,
                      database: lw.blockingDatabase,
                      clientHost: lw.blockingClientHost,
                      state: "Holding the lock #" + lw.waitingPid + " is waiting on",
                      queryText: lw.blockingQuery,
                      durationSeconds: null,
                    })}
                  >
                    Kill blocking session
                  </Link>
                  <Link
                    className="muted"
                    style={{ fontSize: 12, textAlign: "center" }}
                    href={killHref({
                      connectionId: lw.connectionId,
                      connectionName: lw.connectionName,
                      processId: lw.waitingPid,
                      dbUsername: lw.waitingDbUsername,
                      database: lw.waitingDatabase,
                      clientHost: lw.waitingClientHost,
                      state: "Waiting on a lock held by #" + lw.blockingPid,
                      queryText: lw.waitingQuery,
                      durationSeconds: lw.waitSeconds,
                    })}
                  >
                    Kill waiting session instead
                  </Link>
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function QueryDashboard({ role }: { role: Role }) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selected, setSelected] = useState<string>("all");
  const [queries, setQueries] = useState<RunningQuery[]>([]);
  const [lockWaits, setLockWaits] = useState<LockWait[]>([]);
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLD);
  const [errors, setErrors] = useState<{ connectionName: string; message: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [intervalMs, setIntervalMs] = useState<number>(DEFAULT_INTERVAL_MS);
  const canKill = role === "DEVOPS" || role === "ADMIN";

  // Read the saved refresh-interval preference after mount only (not during
  // SSR) so the server-rendered and first client render match, then apply
  // whatever was saved from a previous visit.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(REFRESH_STORAGE_KEY);
      if (stored !== null) {
        const n = Number(stored);
        if (Number.isFinite(n)) setIntervalMs(n);
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — just keep the default.
    }
  }, []);

  function onIntervalChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const n = Number(e.target.value);
    setIntervalMs(n);
    try {
      window.localStorage.setItem(REFRESH_STORAGE_KEY, String(n));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetch("/api/machines")
      .then((r) => r.json())
      .then((d) => setMachines(d.connections ?? []));
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    // minDuration=0: always fetch every currently-executing query (not just
    // ones already over the long-running threshold) — the dashboard splits
    // that one result set into the two sections below.
    const base = selected === "all" ? "/api/queries?minDuration=0" : `/api/queries?connectionId=${selected}&minDuration=0`;
    try {
      const res = await fetch(base);
      const data = await res.json();
      setQueries(data.queries ?? []);
      setLockWaits(data.lockWaits ?? []);
      setErrors(data.errors ?? []);
      if (typeof data.longQueryThresholdSeconds === "number") {
        setThreshold(data.longQueryThresholdSeconds);
      }
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selected]);

  useEffect(() => {
    setLoading(true);
    refresh();
    if (intervalMs <= 0) return; // "Off" — manual refresh only, via the button below
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  const longRunning = useMemo(() => queries.filter((q) => q.durationSeconds >= threshold), [queries, threshold]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          {intervalMs > 0 ? `Auto-refreshes every ${intervalMs / 1000}s` : "Auto-refresh is off — use Refresh now"}
          {lastUpdated && <> &middot; last updated {lastUpdated.toLocaleTimeString()}</>}
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="machine">Database machine</label>
            <select id="machine" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="all">All machines</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="interval">Auto-refresh</label>
            <select id="interval" value={intervalMs} onChange={onIntervalChange}>
              {REFRESH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <button className="secondary" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      </div>

      {errors.length > 0 &&
        errors.map((e) => (
          <div className="alert error" key={e.connectionName}>
            Couldn&apos;t reach <strong>{e.connectionName}</strong>: {e.message}
          </div>
        ))}

      <div className="card" style={{ borderColor: lockWaits.length > 0 ? "var(--danger)" : undefined }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>🔒 Locked / blocked queries</h1>
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 16px" }}>
          A session is stuck waiting for a lock another session is holding — usually the most urgent thing
          to look at, since the session <em>holding</em> the lock is often idle and won&apos;t show up as
          &quot;long-running&quot; at all. Killing the blocking session (not the waiting one) is normally
          what actually fixes this.
        </p>
        {loading && queries.length === 0 && lockWaits.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : (
          <LockWaitTable lockWaits={lockWaits} canKill={canKill} />
        )}
      </div>

      <div className="card">
        <h1 style={{ fontSize: 18, margin: 0 }}>Long-running queries</h1>
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 16px" }}>
          Running {threshold}s or longer &middot; sorted longest-running first
        </p>
        {loading && queries.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : (
          <QueryTable queries={longRunning} canKill={canKill} emptyMessage="No long-running queries right now. 🎉" />
        )}
      </div>

      <div className="card">
        <h1 style={{ fontSize: 18, margin: 0 }}>All currently running queries</h1>
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 16px" }}>
          Every query executing right now, sorted longest-running first
        </p>
        {loading && queries.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : (
          <QueryTable queries={queries} canKill={canKill} emptyMessage="Nothing is running right now." />
        )}
      </div>
    </div>
  );
}
