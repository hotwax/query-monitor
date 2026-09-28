"use client";

import { useState } from "react";
import Link from "next/link";

interface CapturedDetails {
  dbUsername: string | null;
  connectionName: string | null;
  database: string | null;
  clientHost: string | null;
  state: string | null;
  queryText: string | null;
  durationSeconds: number | null;
}

interface LiveStatus {
  checkedAt: Date;
  running: boolean;
  durationSeconds?: number;
  dbUsername?: string;
  clientHost?: string | null;
  database?: string | null;
  queryText?: string | null;
  /** Best-effort comparison against what was captured when Kill Query was clicked. */
  matchesCaptured?: boolean;
}

const CONFIRM_WORD = "confirm";

export default function KillCommandPanel({
  connectionId,
  processId,
  captured,
}: {
  connectionId: string;
  processId: number;
  captured: CapturedDetails;
}) {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [killing, setKilling] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);
  const [killedAt, setKilledAt] = useState<Date | null>(null);

  async function checkStatus() {
    setCheckingStatus(true);
    try {
      const res = await fetch(`/api/queries?connectionId=${connectionId}&minDuration=0`);
      const data = await res.json();
      if (!res.ok) {
        setKillError(data?.error ?? `Could not check status (HTTP ${res.status}).`);
        return;
      }
      interface LiveQueryRow {
        processId: number;
        dbUsername: string;
        clientHost: string | null;
        database: string | null;
        queryText: string | null;
        durationSeconds: number;
      }
      const match: LiveQueryRow | undefined = (data.queries ?? []).find(
        (q: LiveQueryRow) => q.processId === processId
      );
      // A MySQL process/thread ID stays attached to one connection for its
      // whole lifetime, and a connection typically runs many different
      // queries one after another — so the same ID can legitimately be
      // running a completely different statement now than the one that was
      // captured when you clicked Kill Query, simply because time passed.
      const matchesCaptured = match
        ? (captured.queryText ?? null) === (match.queryText ?? null) &&
          (captured.dbUsername ?? null) === (match.dbUsername ?? null)
        : undefined;
      setStatus({
        checkedAt: new Date(),
        running: Boolean(match),
        durationSeconds: match?.durationSeconds,
        dbUsername: match?.dbUsername,
        clientHost: match?.clientHost ?? null,
        database: match?.database ?? null,
        queryText: match?.queryText ?? null,
        matchesCaptured,
      });

      // Part of the event trail — see src/app/api/kill-log/route.ts. Best
      // effort: a logging hiccup shouldn't hide the status you just got.
      fetch("/api/kill-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CHECKED_STATUS",
          connectionId,
          processId,
          running: Boolean(match),
          dbUsername: captured.dbUsername,
          database: captured.database,
          queryText: captured.queryText,
        }),
      }).catch(() => undefined);
    } catch (err) {
      setKillError(err instanceof Error ? err.message : "Could not check status — a network error occurred.");
    } finally {
      setCheckingStatus(false);
    }
  }

  function openModal() {
    setConfirmText("");
    setKillError(null);
    setModalOpen(true);
  }

  async function killNow() {
    setKilling(true);
    setKillError(null);
    try {
      const res = await fetch("/api/kill-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          processId,
          // /api/kill-execute always performs a full connection kill — see
          // its module doc comment. Nothing to specify here.
          dbUsername: captured.dbUsername,
          database: captured.database,
          queryText: captured.queryText,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setKillError(data?.error ?? `Could not kill this query (HTTP ${res.status}).`);
        return;
      }
      setKilledAt(new Date());
      setModalOpen(false);
    } catch (err) {
      setKillError(err instanceof Error ? err.message : "Could not kill this query — a network error occurred.");
    } finally {
      setKilling(false);
    }
  }

  const confirmMatches = confirmText.trim().toLowerCase() === CONFIRM_WORD;

  return (
    <div className="card">
      <Link href="/dashboard" className="muted" style={{ fontSize: 13 }}>
        ← Back to dashboard
      </Link>
      <h1 style={{ fontSize: 18 }}>Kill query #{processId}</h1>

      <div className="alert warn">
        Clicking <strong>Kill Query</strong> below will actually terminate this session — it isn&apos;t
        a preview. It authenticates as a dedicated, narrowly-scoped kill account (not the account that
        ran this query — see below for why), and you&apos;ll be asked to type &quot;confirm&quot;
        before anything happens. One more thing worth knowing: MySQL process/thread IDs stay attached
        to a connection for its whole life, and a connection typically runs many different queries back
        to back — so if time passes between opening this page and killing, the same ID can end up
        pointing at a completely different query. Use <strong>Check current status</strong> first,
        especially if you left this page open for a while.
      </div>

      <p className="section-title" style={{ marginTop: 20 }}>
        Query details (captured when you clicked Kill Query)
      </p>
      <table style={{ marginBottom: 12 }}>
        <tbody>
          <tr>
            <td className="muted">Process ID</td>
            <td>{processId}</td>
          </tr>
          <tr>
            <td className="muted">Machine</td>
            <td>{captured.connectionName || "—"}</td>
          </tr>
          <tr>
            <td className="muted">Database</td>
            <td>{captured.database || <span className="muted">—</span>}</td>
          </tr>
          <tr>
            <td className="muted">DB user (who ran it)</td>
            <td>{captured.dbUsername || <span className="muted">unknown</span>}</td>
          </tr>
          <tr>
            <td className="muted">Client host</td>
            <td className="muted">{captured.clientHost || "—"}</td>
          </tr>
          <tr>
            <td className="muted">State</td>
            <td className="muted">{captured.state || "—"}</td>
          </tr>
          <tr>
            <td className="muted">Duration at click</td>
            <td>{captured.durationSeconds != null ? `${captured.durationSeconds}s` : "—"}</td>
          </tr>
          {captured.queryText && (
            <tr>
              <td className="muted">Query</td>
              <td className="query-text">{captured.queryText}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <button className="secondary" onClick={checkStatus} disabled={checkingStatus}>
          {checkingStatus ? "Checking…" : "Check current status"}
        </button>
        {status &&
          (status.running ? (
            <span className="badge" style={{ color: "var(--ok)", borderColor: "var(--ok)" }}>
              ● Still running — {status.durationSeconds}s (checked {status.checkedAt.toLocaleTimeString()})
            </span>
          ) : (
            <span className="badge">
              ○ Not currently running (checked {status.checkedAt.toLocaleTimeString()})
            </span>
          ))}
      </div>

      {status && status.running && status.matchesCaptured === false && (
        <div className="alert error" style={{ marginBottom: 20 }}>
          <strong>Warning: this is no longer the same query.</strong> Process #{processId} is still
          running, but on this connection it is now executing a different statement than the one you
          captured when you clicked Kill Query. Killing it now would stop whatever it&apos;s running{" "}
          <em>right now</em>, not the one shown above. Currently running as{" "}
          <strong>{status.dbUsername}</strong>
          {status.database ? <> on <strong>{status.database}</strong></> : null}:
          {status.queryText ? (
            <div className="query-text" style={{ marginTop: 8 }}>
              {status.queryText}
            </div>
          ) : (
            <span className="muted"> (no query text available)</span>
          )}
        </div>
      )}

      {status && status.running && status.matchesCaptured === true && (
        <div className="alert" style={{ marginBottom: 20, borderColor: "var(--ok)" }}>
          ✓ Confirmed: still running the same query and DB user you captured.
        </div>
      )}

      <div className="alert" style={{ marginBottom: 16 }}>
        Killing authenticates as a dedicated account created just for this (see
        prisma/rds-kill-user.sql). It can see and terminate any session but cannot read or write any
        table data and cannot manage users. That&apos;s deliberate: in MySQL, killing a session that
        belongs to a <em>different</em> user requires an elevated privilege that AWS RDS/Aurora does
        not let you grant to a regular per-application DB user — so rather than storing every
        application user&apos;s own real password, this app uses one narrowly-scoped, purpose-built
        account instead, and every kill it performs is logged (see the <strong>Kill Log</strong> in
        the nav bar) against whoever is signed in and clicked confirm.
      </div>

      {killError && <div className="alert error">{killError}</div>}

      {killedAt ? (
        <div className="alert ok">✓ Killed process #{processId} at {killedAt.toLocaleTimeString()}.</div>
      ) : (
        <button className="danger" onClick={openModal}>
          Kill Query
        </button>
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => !killing && setModalOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>Kill query #{processId}?</h2>
            <p className="muted" style={{ fontSize: 13.5, marginBottom: 16 }}>
              on <strong>{captured.connectionName || "this machine"}</strong>
              {captured.database ? <> · database <strong>{captured.database}</strong></> : null}
              {captured.dbUsername ? <> · run by <strong>{captured.dbUsername}</strong></> : null}
            </p>
            {captured.queryText && (
              <div className="query-text" style={{ marginBottom: 16 }}>
                {captured.queryText}
              </div>
            )}
            <div className="alert error">
              This will immediately terminate the connection and any query running on it. This action
              is <strong>destructive and cannot be undone</strong>.
            </div>
            <div className="field">
              <label htmlFor="confirm-word">
                Type <strong>confirm</strong> to proceed
              </label>
              <input
                id="confirm-word"
                className="confirm-input"
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="confirm"
              />
            </div>
            {killError && <div className="alert error">{killError}</div>}
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
              <button className="secondary" onClick={() => setModalOpen(false)} disabled={killing}>
                Cancel
              </button>
              <button className="danger" onClick={killNow} disabled={!confirmMatches || killing}>
                {killing ? "Killing…" : "Kill Query"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
