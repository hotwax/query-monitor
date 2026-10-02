"use client";

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import type { Role } from "@/lib/types";
import BulkKillModal, { type BulkKillTarget } from "@/components/BulkKillModal";

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

/** Matches a running query to its row across renders/tables — stable as
 * long as the underlying MySQL thread is the same, which is exactly the
 * lifetime a selection checkbox needs to track. */
function rowKey(q: Pick<RunningQuery, "connectionId" | "processId">): string {
  return `${q.connectionId}-${q.processId}`;
}

type SortKey = "duration" | "database" | "dbUser" | "clientHost";
type SortDir = "asc" | "desc";

function sortQueries(queries: RunningQuery[], key: SortKey, dir: SortDir): RunningQuery[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...queries].sort((a, b) => {
    if (key === "duration") return (a.durationSeconds - b.durationSeconds) * sign;
    if (key === "database") return (a.database ?? "").localeCompare(b.database ?? "") * sign;
    if (key === "dbUser") return a.dbUsername.localeCompare(b.dbUsername) * sign;
    return (a.clientHost ?? "").localeCompare(b.clientHost ?? "") * sign;
  });
}

// --- "Focus" — pin every row matching one picked value to the top -------
//
// Separate from the plain A-Z/Z-A sort above: sorting changes the order of
// EVERY row; focusing picks one value (e.g. one DB user) and pulls just
// the matching rows to the top, in front of everything else, so a shared
// database with many clients' queries interleaved can be narrowed down to
// one client's activity without losing sight of the rest. The two work
// together — rows keep whatever sort order they had within the pinned
// group and within the rest.
type FocusColumn = "database" | "dbUser" | "clientHost" | "state";
interface Focus {
  column: FocusColumn;
  value: string;
}

function focusValueOf(q: RunningQuery, column: FocusColumn): string | null {
  if (column === "database") return q.database;
  if (column === "dbUser") return q.dbUsername;
  if (column === "clientHost") return q.clientHost;
  return q.state ?? q.command;
}

/** Every distinct value currently in this column, for the picker — plus the
 * currently-focused value even if it has since dropped to zero matches, so
 * the dropdown never silently "forgets" what you had selected. */
function distinctFocusValues(queries: RunningQuery[], column: FocusColumn, currentValue: string | null): string[] {
  const values = new Set<string>();
  for (const q of queries) {
    const v = focusValueOf(q, column);
    if (v) values.add(v);
  }
  if (currentValue) values.add(currentValue);
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

/** Stable partition: matching rows first (in their existing order), then
 * everything else (also in their existing order) — never re-sorts within
 * either group, just regroups. */
function applyFocus(queries: RunningQuery[], focus: Focus | null): RunningQuery[] {
  if (!focus) return queries;
  const pinned: RunningQuery[] = [];
  const rest: RunningQuery[] = [];
  for (const q of queries) {
    (focusValueOf(q, focus.column) === focus.value ? pinned : rest).push(q);
  }
  return [...pinned, ...rest];
}

function FocusPicker({
  label = "Focus",
  values,
  value,
  onChange,
  compact = true,
}: {
  /** Defaults to "Focus:" for a column header's own picker; pass something
   * like "DB user" for a standalone toolbar (e.g. LockWaitTable) where
   * several pickers for different fields sit side by side and need their
   * own label to tell them apart. */
  label?: string;
  values: string[];
  value: string | null;
  onChange: (value: string | null) => void;
  compact?: boolean;
}) {
  return (
    <span
      className="muted"
      style={{
        marginLeft: compact ? 8 : 0,
        fontWeight: 400,
        fontSize: compact ? 11 : 12.5,
        textTransform: "none",
        letterSpacing: 0,
      }}
    >
      {label}:{" "}
      <select
        value={value ?? ""}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ fontSize: compact ? 11 : 12.5, padding: "1px 3px", width: "auto" }}
        title="Pin rows matching this value to the top of the table"
      >
        <option value="">All</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </span>
  );
}

function ColumnHeader({
  label,
  sortKey,
  activeSortKey,
  activeSortDir,
  onSort,
  focusColumn,
  focusValues,
  activeFocus,
  onFocusChange,
}: {
  label: string;
  /** Omit for a column that doesn't support the plain A-Z/Z-A sort (e.g. State). */
  sortKey?: SortKey;
  activeSortKey?: SortKey;
  activeSortDir?: SortDir;
  onSort?: (key: SortKey) => void;
  /** Omit for a column with no Focus picker (Duration, Machine, Query). */
  focusColumn?: FocusColumn;
  focusValues?: string[];
  activeFocus?: Focus | null;
  onFocusChange?: (column: FocusColumn, value: string | null) => void;
}) {
  const sortable = sortKey !== undefined;
  const sortActive = sortable && sortKey === activeSortKey;
  return (
    <th style={{ userSelect: "none" }}>
      <span
        onClick={sortable ? () => onSort!(sortKey!) : undefined}
        style={sortable ? { cursor: "pointer" } : undefined}
        title={sortable ? "Click to sort" : undefined}
      >
        {label}
        {sortActive && <span style={{ marginLeft: 4 }}>{activeSortDir === "asc" ? "▲" : "▼"}</span>}
      </span>
      {focusColumn && (
        <FocusPicker
          values={focusValues ?? []}
          value={activeFocus?.column === focusColumn ? activeFocus.value : null}
          onChange={(v) => onFocusChange!(focusColumn, v)}
        />
      )}
    </th>
  );
}

function QueryTable({
  queries,
  canKill,
  emptyMessage,
  selected,
  onToggleSelect,
  machineId,
}: {
  queries: RunningQuery[];
  canKill: boolean;
  emptyMessage: string;
  /** Keys (rowKey(q)) of currently selected rows, for bulk-kill. No "select all" — see BulkKillModal for why each row is picked deliberately. */
  selected: Set<string>;
  onToggleSelect: (query: RunningQuery) => void;
  /** Resets the Focus picker when the chosen machine changes — a different machine means a completely different set of DB users/databases to focus on. */
  machineId: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("duration");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [focus, setFocus] = useState<Focus | null>(null);

  useEffect(() => {
    setFocus(null);
  }, [machineId]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "duration" ? "desc" : "asc");
    }
  }

  function handleFocusChange(column: FocusColumn, value: string | null) {
    setFocus(value ? { column, value } : null);
  }

  const databaseValues = useMemo(
    () => distinctFocusValues(queries, "database", focus?.column === "database" ? focus.value : null),
    [queries, focus]
  );
  const dbUserValues = useMemo(
    () => distinctFocusValues(queries, "dbUser", focus?.column === "dbUser" ? focus.value : null),
    [queries, focus]
  );
  const clientHostValues = useMemo(
    () => distinctFocusValues(queries, "clientHost", focus?.column === "clientHost" ? focus.value : null),
    [queries, focus]
  );
  const stateValues = useMemo(
    () => distinctFocusValues(queries, "state", focus?.column === "state" ? focus.value : null),
    [queries, focus]
  );

  if (queries.length === 0) {
    return <p className="muted">{emptyMessage}</p>;
  }
  const sorted = sortQueries(queries, sortKey, sortDir);
  const final = applyFocus(sorted, focus);
  const pinnedCount = focus ? final.filter((q) => focusValueOf(q, focus.column) === focus.value).length : 0;
  const colSpan = (canKill ? 1 : 0) + 6 + (canKill ? 1 : 0);

  return (
    <table>
      <thead>
        <tr>
          {canKill && <th></th>}
          <ColumnHeader label="Duration" sortKey="duration" activeSortKey={sortKey} activeSortDir={sortDir} onSort={handleSort} />
          <th>Machine</th>
          <ColumnHeader
            label="Database"
            sortKey="database"
            activeSortKey={sortKey}
            activeSortDir={sortDir}
            onSort={handleSort}
            focusColumn="database"
            focusValues={databaseValues}
            activeFocus={focus}
            onFocusChange={handleFocusChange}
          />
          <ColumnHeader
            label="DB user"
            sortKey="dbUser"
            activeSortKey={sortKey}
            activeSortDir={sortDir}
            onSort={handleSort}
            focusColumn="dbUser"
            focusValues={dbUserValues}
            activeFocus={focus}
            onFocusChange={handleFocusChange}
          />
          <ColumnHeader
            label="Client host"
            sortKey="clientHost"
            activeSortKey={sortKey}
            activeSortDir={sortDir}
            onSort={handleSort}
            focusColumn="clientHost"
            focusValues={clientHostValues}
            activeFocus={focus}
            onFocusChange={handleFocusChange}
          />
          <ColumnHeader label="State" focusColumn="state" focusValues={stateValues} activeFocus={focus} onFocusChange={handleFocusChange} />
          <th>Query</th>
          {canKill && <th></th>}
        </tr>
      </thead>
      <tbody>
        {final.map((q, i) => (
          <Fragment key={rowKey(q)}>
            {focus && i === pinnedCount && pinnedCount > 0 && pinnedCount < final.length && (
              <tr key="focus-divider">
                <td colSpan={colSpan} style={{ borderTop: "1px dashed var(--border)", padding: 0 }}></td>
              </tr>
            )}
            <tr key={rowKey(q)} style={focus && i < pinnedCount ? { background: "var(--panel-2)" } : undefined}>
              {canKill && (
                <td>
                  <input type="checkbox" checked={selected.has(rowKey(q))} onChange={() => onToggleSelect(q)} />
                </td>
              )}
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
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

// Same Focus idea as QueryTable, adapted to this table's shape: there's no
// single "DB user" or "Database" column here — each row has a blocking
// side and a waiting side, each with its own. Pinning matches a row if
// EITHER side belongs to the focused value, since the point is "show me
// every lock conflict touching this one client," whichever role they're
// playing in it.
type LockFocusKind = "dbUser" | "database";
interface LockFocus {
  kind: LockFocusKind;
  value: string;
}

function lockFocusMatches(lw: LockWait, focus: LockFocus): boolean {
  if (focus.kind === "dbUser") {
    return lw.blockingDbUsername === focus.value || lw.waitingDbUsername === focus.value;
  }
  return lw.blockingDatabase === focus.value || lw.waitingDatabase === focus.value;
}

function distinctLockFocusValues(lockWaits: LockWait[], kind: LockFocusKind, currentValue: string | null): string[] {
  const values = new Set<string>();
  for (const lw of lockWaits) {
    const a = kind === "dbUser" ? lw.blockingDbUsername : lw.blockingDatabase;
    const b = kind === "dbUser" ? lw.waitingDbUsername : lw.waitingDatabase;
    if (a) values.add(a);
    if (b) values.add(b);
  }
  if (currentValue) values.add(currentValue);
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function applyLockFocus(lockWaits: LockWait[], focus: LockFocus | null): LockWait[] {
  if (!focus) return lockWaits;
  const pinned: LockWait[] = [];
  const rest: LockWait[] = [];
  for (const lw of lockWaits) {
    (lockFocusMatches(lw, focus) ? pinned : rest).push(lw);
  }
  return [...pinned, ...rest];
}

function LockWaitTable({ lockWaits, canKill, machineId }: { lockWaits: LockWait[]; canKill: boolean; machineId: string }) {
  const [focus, setFocus] = useState<LockFocus | null>(null);

  useEffect(() => {
    setFocus(null);
  }, [machineId]);

  const dbUserValues = useMemo(
    () => distinctLockFocusValues(lockWaits, "dbUser", focus?.kind === "dbUser" ? focus.value : null),
    [lockWaits, focus]
  );
  const databaseValues = useMemo(
    () => distinctLockFocusValues(lockWaits, "database", focus?.kind === "database" ? focus.value : null),
    [lockWaits, focus]
  );

  if (lockWaits.length === 0) {
    return <p className="muted">No blocked queries right now.</p>;
  }

  const final = applyLockFocus(lockWaits, focus);
  const pinnedCount = focus ? final.filter((lw) => lockFocusMatches(lw, focus)).length : 0;
  const colSpan = 4 + (canKill ? 1 : 0);

  return (
    <>
      <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
        <FocusPicker
          label="DB user"
          compact={false}
          values={dbUserValues}
          value={focus?.kind === "dbUser" ? focus.value : null}
          onChange={(v) => setFocus(v ? { kind: "dbUser", value: v } : null)}
        />
        <FocusPicker
          label="Database"
          compact={false}
          values={databaseValues}
          value={focus?.kind === "database" ? focus.value : null}
          onChange={(v) => setFocus(v ? { kind: "database", value: v } : null)}
        />
      </div>
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
          {final.map((lw, i) => (
            <Fragment key={`${lw.connectionId}-${lw.blockingPid}-${lw.waitingPid}`}>
              {focus && i === pinnedCount && pinnedCount > 0 && pinnedCount < final.length && (
                <tr key="lock-focus-divider">
                  <td colSpan={colSpan} style={{ borderTop: "1px dashed var(--border)", padding: 0 }}></td>
                </tr>
              )}
              <tr style={focus && i < pinnedCount ? { background: "var(--panel-2)" } : undefined}>
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
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function QueryDashboard({ role }: { role: Role }) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [queries, setQueries] = useState<RunningQuery[]>([]);
  const [lockWaits, setLockWaits] = useState<LockWait[]>([]);
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLD);
  const [errors, setErrors] = useState<{ connectionName: string; message: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [intervalMs, setIntervalMs] = useState<number>(DEFAULT_INTERVAL_MS);
  const canKill = role === "DEVOPS" || role === "ADMIN";

  // Bulk-kill selection — keyed by rowKey() so a query checked in one table
  // (e.g. "Long-running") shows checked in the other ("All currently
  // running") too, since they can both list the same underlying process.
  // Deliberately scoped to whichever machine is selected above: switching
  // machines means a completely different set of queries, so the selection
  // is cleared rather than silently carrying over.
  const [selectedMap, setSelectedMap] = useState<Map<string, RunningQuery>>(new Map());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  useEffect(() => {
    setSelectedMap(new Map());
  }, [selected]);

  function toggleSelect(query: RunningQuery) {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      const key = rowKey(query);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, query);
      }
      return next;
    });
  }

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
      .then((d) => {
        const connections = d.connections ?? [];
        setMachines(connections);
        // No "All machines" option anymore — always land on a specific
        // machine, defaulting to the first one registered.
        setSelected((current) => current || connections[0]?.id || "");
      });
  }, []);

  const refresh = useCallback(async () => {
    if (!selected) return;
    setRefreshing(true);
    // minDuration=0: always fetch every currently-executing query (not just
    // ones already over the long-running threshold) — the dashboard splits
    // that one result set into the two sections below.
    try {
      const res = await fetch(`/api/queries?connectionId=${selected}&minDuration=0`);
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
    if (!selected) {
      setLoading(false);
      return;
    }
    setLoading(true);
    refresh();
    if (intervalMs <= 0) return; // "Off" — manual refresh only, via the button below
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs, selected]);

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
            {machines.length === 0 ? (
              <select id="machine" disabled>
                <option>No machines registered</option>
              </select>
            ) : (
              <select id="machine" value={selected} onChange={(e) => setSelected(e.target.value)}>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
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

      {selectedMap.size > 0 && (
        <div
          className="card"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderColor: "var(--accent)",
            padding: "12px 20px",
          }}
        >
          <span>
            <strong>{selectedMap.size}</strong> selected
          </span>
          <div style={{ display: "flex", gap: 12 }}>
            <button className="secondary" onClick={() => setSelectedMap(new Map())}>
              Clear selection
            </button>
            <button className="danger" onClick={() => setBulkModalOpen(true)}>
              Kill {selectedMap.size} Quer{selectedMap.size === 1 ? "y" : "ies"}
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ borderColor: lockWaits.length > 0 ? "var(--danger)" : undefined }}>
        <h1 style={{ fontSize: 18, margin: "0 0 16px" }}>Locked / blocked queries</h1>
        {loading && queries.length === 0 && lockWaits.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : (
          <LockWaitTable lockWaits={lockWaits} canKill={canKill} machineId={selected} />
        )}
      </div>

      <div className="card">
        <h1 style={{ fontSize: 18, margin: 0 }}>Long-running queries</h1>
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 16px" }}>
          Running {threshold}s or longer &middot; click a column header to sort
        </p>
        {loading && queries.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : (
          <QueryTable
            queries={longRunning}
            canKill={canKill}
            emptyMessage="No long-running queries right now."
            selected={new Set(selectedMap.keys())}
            onToggleSelect={toggleSelect}
            machineId={selected}
          />
        )}
      </div>

      <div className="card">
        <h1 style={{ fontSize: 18, margin: 0 }}>All currently running queries</h1>
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 16px" }}>
          Every query executing right now &middot; click a column header to sort
        </p>
        {loading && queries.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : (
          <QueryTable
            queries={queries}
            canKill={canKill}
            emptyMessage="Nothing is running right now."
            selected={new Set(selectedMap.keys())}
            onToggleSelect={toggleSelect}
            machineId={selected}
          />
        )}
      </div>

      {bulkModalOpen && (
        <BulkKillModal
          connectionId={selected}
          connectionName={machines.find((m) => m.id === selected)?.name ?? ""}
          targets={Array.from(selectedMap.values()).map(
            (q): BulkKillTarget => ({
              processId: q.processId,
              dbUsername: q.dbUsername,
              database: q.database,
              queryText: q.queryText,
              durationSeconds: q.durationSeconds,
            })
          )}
          onClose={() => setBulkModalOpen(false)}
          onKillCompleted={(killedProcessIds) => {
            const killed = new Set(killedProcessIds);
            setSelectedMap((prev) => {
              const next = new Map(prev);
              for (const [key, q] of prev) {
                if (killed.has(q.processId)) next.delete(key);
              }
              return next;
            });
            setBulkModalOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
