"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

interface Entry {
  id: string;
  connectionName: string;
  databaseName: string | null;
  dbUsername: string;
  clientHost: string | null;
  queryText: string | null;
  processId: number;
  category: "WARNING" | "LONG" | "CRITICAL" | "SEVERE";
  status: "RUNNING" | "ENDED";
  firstDetectedAt: string;
  lastSeenAt: string;
  maxDurationSeconds: number;
}

interface FiltersResponse {
  machines: { id: string; name: string }[];
  databases: string[];
  categories: { value: string; label: string }[];
  minDurationSeconds: number;
}

const CATEGORY_COLOR: Record<string, string> = {
  WARNING: "var(--warn)",
  LONG: "var(--accent)",
  CRITICAL: "var(--danger)",
  SEVERE: "var(--danger)",
};

function formatDuration(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

export default function QueryHistory() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [filterOptions, setFilterOptions] = useState<FiltersResponse>({
    machines: [],
    databases: [],
    categories: [],
    minDurationSeconds: 30 * 60,
  });
  const [connectionId, setConnectionId] = useState("");
  const [databaseName, setDatabaseName] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    fetch("/api/slow-queries/filters")
      .then((res) => res.json())
      .then((data) => setFilterOptions(data))
      .catch(() => undefined);
  }, []);

  const buildParams = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams();
      if (connectionId) params.set("connectionId", connectionId);
      if (databaseName) params.set("databaseName", databaseName);
      if (category) params.set("category", category);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());
      Object.entries(extra).forEach(([k, v]) => params.set(k, v));
      return params;
    },
    [connectionId, databaseName, category, from, to]
  );

  const load = useCallback(
    async (targetPage = 1) => {
      setLoading(true);
      setError(null);
      try {
        const params = buildParams({ page: String(targetPage) });
        const res = await fetch(`/api/slow-queries?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Could not load query history.");
          return;
        }
        setEntries(data.items ?? []);
        setTotal(data.total ?? 0);
        setPage(data.page ?? 1);
        setTotalPages(data.totalPages ?? 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load query history.");
      } finally {
        setLoading(false);
      }
    },
    [buildParams]
  );

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, databaseName, category, from, to]);

  async function exportXlsx() {
    setExporting(true);
    try {
      const params = buildParams();
      const res = await fetch(`/api/slow-queries/export?${params.toString()}`);
      if (!res.ok) {
        setError("Could not generate the export.");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match?.[1] ?? "slow-query-history.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  function clearFilters() {
    setConnectionId("");
    setDatabaseName("");
    setCategory("");
    setFrom("");
    setTo("");
  }

  const hasFilters = Boolean(connectionId || databaseName || category || from || to);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <p className="section-title" style={{ margin: 0 }}>
            Query History
          </p>
          <p className="muted" style={{ fontSize: 13, margin: "4px 0 0", maxWidth: 640 }}>
            A permanent record of every query that ran {formatDuration(filterOptions.minDurationSeconds)}{" "}
            or longer, on any machine with tracking turned on (see DB Machines to enable it per
            machine, and to change that floor). Kept for 30 days, then removed automatically.
          </p>
        </div>
        <button onClick={exportXlsx} disabled={exporting || loading}>
          {exporting ? "Preparing…" : "Export to Excel"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Machine</label>
          <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            <option value="">All machines</option>
            {filterOptions.machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Database</label>
          <select value={databaseName} onChange={(e) => setDatabaseName(e.target.value)}>
            <option value="">All databases</option>
            {filterOptions.databases.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Severity</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All severities</option>
            {filterOptions.categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {hasFilters && (
          <button className="secondary" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="muted">
          {hasFilters
            ? "No slow queries match these filters."
            : `Nothing recorded yet — either no query has run past ${formatDuration(
                filterOptions.minDurationSeconds
              )}, or no machine has tracking turned on yet (see DB Machines).`}
        </p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Detected</th>
                <th>Machine</th>
                <th>Database</th>
                <th>DB user</th>
                <th>Duration</th>
                <th>Severity</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <td className="muted">{new Date(e.firstDetectedAt).toLocaleString()}</td>
                    <td>{e.connectionName}</td>
                    <td>{e.databaseName ?? <span className="muted">—</span>}</td>
                    <td>{e.dbUsername}</td>
                    <td>{formatDuration(e.maxDurationSeconds)}</td>
                    <td>
                      <span className="badge" style={{ color: CATEGORY_COLOR[e.category], borderColor: CATEGORY_COLOR[e.category] }}>
                        {e.category}
                      </span>
                    </td>
                    <td className="muted">{e.status === "RUNNING" ? "Still running" : "Ended"}</td>
                    <td>
                      {e.queryText && (
                        <button className="secondary" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                          {expanded === e.id ? "Hide query" : "View query"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === e.id && e.queryText && (
                    <tr>
                      <td colSpan={8}>
                        <pre
                          style={{
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                            margin: 0,
                            padding: 10,
                            background: "var(--panel-2)",
                            borderRadius: 6,
                            fontSize: 12,
                          }}
                        >
                          {e.queryText}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {total} entr{total === 1 ? "y" : "ies"} · page {page} of {totalPages}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="secondary" disabled={page <= 1} onClick={() => load(page - 1)}>
                Previous
              </button>
              <button className="secondary" disabled={page >= totalPages} onClick={() => load(page + 1)}>
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
