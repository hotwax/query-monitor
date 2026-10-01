"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

interface LogEntry {
  id: string;
  actorEmail: string;
  action: "VIEWED_KILL_PAGE" | "CHECKED_STATUS" | "KILL_EXECUTED" | "KILL_FAILED" | "REVEAL_KILL_COMMAND" | "CONFIRMED_KILL";
  connectionName: string | null;
  detail: {
    processId?: number;
    method?: "CONNECTION" | "QUERY_ONLY";
    killAccount?: string | null;
    dbUsername?: string | null;
    database?: string | null;
    queryText?: string | null;
    running?: boolean | null;
    error?: string | null;
  } | null;
  createdAt: string;
}

type Filter = "all" | "kills" | "activity";

const ACTION_LABELS: Record<LogEntry["action"], { text: string; color?: string }> = {
  VIEWED_KILL_PAGE: { text: "Opened kill page" },
  CHECKED_STATUS: { text: "Checked status" },
  KILL_EXECUTED: { text: "✓ Killed", color: "var(--ok)" },
  KILL_FAILED: { text: "✕ Kill failed", color: "var(--danger)" },
  // Legacy, from the earlier "reveal a command" design.
  REVEAL_KILL_COMMAND: { text: "Viewed command (legacy)" },
  CONFIRMED_KILL: { text: "✓ Confirmed killed (legacy)", color: "var(--ok)" },
};

function formatMethod(method?: string | null): string {
  if (method === "QUERY_ONLY") return "Query only";
  if (method === "CONNECTION") return "Whole connection";
  return "—";
}

export default function KillLogAdmin() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kill-log?limit=50");
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not load the kill log.");
        return;
      }
      setEntries(data.entries ?? []);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the kill log.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/kill-log?limit=50&before=${nextCursor}`);
      const data = await res.json();
      if (res.ok) {
        setEntries((prev) => [...prev, ...(data.entries ?? [])]);
        setNextCursor(data.nextCursor ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  const visible = entries.filter((e) => {
    if (filter === "kills") return e.action === "KILL_EXECUTED" || e.action === "KILL_FAILED" || e.action === "CONFIRMED_KILL";
    if (filter === "activity") return e.action === "VIEWED_KILL_PAGE" || e.action === "CHECKED_STATUS";
    return true;
  });

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ maxWidth: 640 }}>
          <p className="section-title" style={{ margin: 0 }}>
            Kill Log
          </p>
          <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            The full trail for every kill attempt — who opened the kill page, who checked status, and
            who actually killed (or tried to kill) a query, with the query and DB user involved.
            Newest first.
          </p>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="filter">Show</label>
          <select id="filter" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All activity</option>
            <option value="kills">Kills only (executed/failed)</option>
            <option value="activity">Page views & status checks</option>
          </select>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="muted">No activity yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Machine</th>
              <th>Process ID</th>
              <th>Method</th>
              <th>DB user (ran it)</th>
              <th>Database</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => {
              const label = ACTION_LABELS[e.action] ?? { text: e.action };
              return (
                <Fragment key={e.id}>
                  <tr>
                    <td className="muted">{new Date(e.createdAt).toLocaleString()}</td>
                    <td>{e.actorEmail}</td>
                    <td>
                      <span className="badge" style={label.color ? { color: label.color, borderColor: label.color } : undefined}>
                        {label.text}
                      </span>
                    </td>
                    <td>{e.connectionName ?? <span className="muted">—</span>}</td>
                    <td>{e.detail?.processId ?? <span className="muted">—</span>}</td>
                    <td className="muted">{formatMethod(e.detail?.method)}</td>
                    <td>{e.detail?.dbUsername || <span className="muted">unknown</span>}</td>
                    <td>{e.detail?.database || <span className="muted">—</span>}</td>
                    <td>
                      {(e.detail?.queryText || e.detail?.error) && (
                        <button
                          className="secondary"
                          style={{ fontSize: 12, padding: "4px 8px" }}
                          onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                        >
                          {expanded === e.id ? "Hide" : "View"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === e.id && (e.detail?.queryText || e.detail?.error) && (
                    <tr>
                      <td colSpan={9}>
                        {e.detail?.queryText && <div className="query-text">{e.detail.queryText}</div>}
                        {e.detail?.error && (
                          <div className="alert error" style={{ marginTop: e.detail?.queryText ? 8 : 0 }}>
                            {e.detail.error}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {nextCursor && (
        <button className="secondary" style={{ marginTop: 16 }} onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
