"use client";

import { useState } from "react";

export interface BulkKillTarget {
  processId: number;
  dbUsername: string;
  database: string | null;
  queryText: string | null;
  durationSeconds: number;
}

interface LiveStatus {
  running: boolean;
  durationSeconds?: number;
}

interface ItemResult {
  ok: boolean;
  error?: string;
}

const CONFIRM_WORD = "confirm";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

/**
 * Confirmation + execution flow for killing several queries at once from
 * the Dashboard's checkbox selection. Deliberately a modal rather than a
 * page navigation like the single-query Kill page — the captured details
 * (including full query text, which can run hundreds of lines — see
 * kill-modal-scroll-fix) can't travel through a URL for more than one
 * query at a time, but the Dashboard already holds the full selected
 * objects in memory, so this just renders straight from that.
 *
 * "Check current status" re-checks every selected query against what's
 * ACTUALLY still running right now (the selection can go stale the same
 * way a single query's status can — see KillCommandPanel.tsx). Anything
 * confirmed to have already finished is excluded from the kill batch
 * automatically rather than being sent to /api/kill-execute-bulk at all —
 * there's nothing to kill, so there's nothing to attempt.
 */
export default function BulkKillModal({
  connectionId,
  connectionName,
  targets,
  onClose,
  onKillCompleted,
}: {
  connectionId: string;
  connectionName: string;
  targets: BulkKillTarget[];
  /** Dismiss without having killed anything (Cancel, or the overlay click). */
  onClose: () => void;
  /** Fires once the batch request has finished; passes the processIds that were actually killed so the Dashboard can drop them from the selection. */
  onKillCompleted: (killedProcessIds: number[]) => void;
}) {
  const [liveStatus, setLiveStatus] = useState<Map<number, LiveStatus>>(new Map());
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [killing, setKilling] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [results, setResults] = useState<Map<number, ItemResult> | null>(null);

  // Anything explicitly confirmed as no-longer-running gets excluded; an
  // unchecked query (status never looked up) is treated the same as today's
  // single-kill page treats it — assumed possibly still running, and left
  // for the live pre-kill check inside /api/kill-execute-bulk to catch if
  // it turns out to have finished in the meantime.
  const toKill = targets.filter((t) => liveStatus.get(t.processId)?.running !== false);

  async function checkStatus() {
    setCheckingStatus(true);
    setBatchError(null);
    try {
      const res = await fetch(`/api/queries?connectionId=${connectionId}&minDuration=0`);
      const data = await res.json();
      if (!res.ok) {
        setBatchError(data?.error ?? "Could not check status.");
        return;
      }
      interface LiveQueryRow {
        processId: number;
        durationSeconds: number;
      }
      const liveById = new Map<number, LiveQueryRow>(
        (data.queries ?? []).map((q: LiveQueryRow) => [q.processId, q])
      );
      const next = new Map<number, LiveStatus>();
      for (const t of targets) {
        const match = liveById.get(t.processId);
        next.set(t.processId, { running: Boolean(match), durationSeconds: match?.durationSeconds });
      }
      setLiveStatus(next);
      setCheckedAt(new Date());

      // Best-effort event trail, same as the single-kill page's "Check
      // current status" — a logging hiccup shouldn't block the check itself.
      for (const t of targets) {
        fetch("/api/kill-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "CHECKED_STATUS",
            connectionId,
            processId: t.processId,
            running: Boolean(liveById.get(t.processId)),
            dbUsername: t.dbUsername,
            database: t.database,
            queryText: t.queryText,
          }),
        }).catch(() => undefined);
      }
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Could not check status — a network error occurred.");
    } finally {
      setCheckingStatus(false);
    }
  }

  async function killNow() {
    setKilling(true);
    setBatchError(null);
    try {
      const res = await fetch("/api/kill-execute-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          processes: toKill.map((t) => ({
            processId: t.processId,
            dbUsername: t.dbUsername,
            database: t.database,
            queryText: t.queryText,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setBatchError(data?.error ?? `Could not run the bulk kill (HTTP ${res.status}).`);
        return;
      }
      interface ApiResult {
        processId: number;
        ok: boolean;
        error?: string;
      }
      const resultMap = new Map<number, ItemResult>(
        (data.results ?? []).map((r: ApiResult) => [r.processId, { ok: r.ok, error: r.error }])
      );
      setResults(resultMap);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Could not run the bulk kill — a network error occurred.");
    } finally {
      setKilling(false);
    }
  }

  function close() {
    if (results) {
      const killedIds = Array.from(results.entries())
        .filter(([, r]) => r.ok)
        .map(([processId]) => processId);
      onKillCompleted(killedIds);
    } else {
      onClose();
    }
  }

  const confirmMatches = confirmText.trim().toLowerCase() === CONFIRM_WORD;
  const alreadyFinishedCount = targets.length - toKill.length;

  return (
    <div className="modal-overlay" onClick={() => !killing && close()}>
      <div className="modal-box" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <h2>
          Kill {targets.length} quer{targets.length === 1 ? "y" : "ies"}?
        </h2>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 16 }}>
          on <strong>{connectionName}</strong>
        </p>

        {!results && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <button className="secondary" onClick={checkStatus} disabled={checkingStatus || killing}>
              {checkingStatus ? "Checking…" : "Check current status"}
            </button>
            {checkedAt && (
              <span className="muted" style={{ fontSize: 12.5 }}>
                Checked {checkedAt.toLocaleTimeString()}
                {alreadyFinishedCount > 0
                  ? ` — ${alreadyFinishedCount} already finished and will be skipped`
                  : " — all still running"}
              </span>
            )}
          </div>
        )}

        <div
          style={{
            maxHeight: 320,
            overflowY: "auto",
            marginBottom: 16,
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <table style={{ marginBottom: 0 }}>
            <tbody>
              {targets.map((t) => {
                const live = liveStatus.get(t.processId);
                const finished = live?.running === false;
                const result = results?.get(t.processId);
                return (
                  <tr key={t.processId} style={finished ? { opacity: 0.55 } : undefined}>
                    <td>
                      <div>
                        <strong>#{t.processId}</strong> · {t.dbUsername}
                        {t.database ? <> · {t.database}</> : null} ·{" "}
                        <span className="muted">{formatDuration(live?.durationSeconds ?? t.durationSeconds)}</span>
                      </div>
                      {t.queryText && (
                        <div className="query-text" style={{ marginTop: 4 }}>
                          {t.queryText}
                        </div>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap", verticalAlign: "top", textAlign: "right" }}>
                      {result ? (
                        result.ok ? (
                          <span style={{ color: "var(--ok)" }}>✓ Killed</span>
                        ) : (
                          <span style={{ color: "var(--danger)" }}>✕ {result.error ?? "Failed"}</span>
                        )
                      ) : finished ? (
                        <span className="muted">Already finished — skipped</span>
                      ) : live?.running === true ? (
                        <span style={{ color: "var(--ok)" }}>● Still running</span>
                      ) : (
                        <span className="muted">Not checked</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!results && (
          <>
            {toKill.length === 0 ? (
              <div className="alert">All selected queries have already finished — there is nothing to kill.</div>
            ) : (
              <>
                <div className="alert error">
                  This will immediately terminate {toKill.length} connection{toKill.length === 1 ? "" : "s"} and any
                  quer{toKill.length === 1 ? "y" : "ies"} running on {toKill.length === 1 ? "it" : "them"}. This
                  action is <strong>destructive and cannot be undone</strong>.
                </div>
                <div className="field">
                  <label htmlFor="bulk-confirm-word">
                    Type <strong>confirm</strong> to proceed
                  </label>
                  <input
                    id="bulk-confirm-word"
                    className="confirm-input"
                    autoFocus
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="confirm"
                  />
                </div>
              </>
            )}
          </>
        )}

        {batchError && <div className="alert error">{batchError}</div>}

        {results && (
          <div className="alert ok">
            {Array.from(results.values()).filter((r) => r.ok).length} of {toKill.length} killed
            {alreadyFinishedCount > 0 ? ` (${alreadyFinishedCount} already finished, skipped)` : ""}.
          </div>
        )}

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
          {results ? (
            <button className="secondary" onClick={close}>
              Close
            </button>
          ) : (
            <>
              <button className="secondary" onClick={onClose} disabled={killing}>
                Cancel
              </button>
              <button className="danger" onClick={killNow} disabled={!confirmMatches || killing || toKill.length === 0}>
                {killing ? "Killing…" : `Kill ${toKill.length} Quer${toKill.length === 1 ? "y" : "ies"}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
