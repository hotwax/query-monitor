"use client";

import { useEffect, useState } from "react";

interface BeginResult {
  qrDataUrl: string;
  secretBase32: string;
  email: string;
}

type ConfirmResult = { ok: true; backupCodes: string[] } | { ok: false; error: string };

/**
 * The actual "scan this QR code, type back the 6-digit code" screen — used
 * both for first-time onboarding (right after a correct password, for any
 * account without MFA yet) and for the lost-device email-recovery flow
 * (re-doing setup from scratch). The two callers differ only in how setup
 * is begun/confirmed and what happens afterward, so those are passed in as
 * plain async functions rather than baking specific API routes in here.
 */
export default function MfaSetupPanel({
  begin,
  confirm,
  onConfirmed,
  doneMessage,
}: {
  begin: () => Promise<BeginResult>;
  confirm: (code: string) => Promise<ConfirmResult>;
  onConfirmed?: () => void;
  /** Shown after backup codes, once the user has clicked "I've saved these". */
  doneMessage: React.ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secretBase32, setSecretBase32] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    begin()
      .then((result) => {
        if (cancelled) return;
        setQrDataUrl(result.qrDataUrl);
        setSecretBase32(result.secretBase32);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not start MFA setup.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setConfirming(true);
    setError(null);
    try {
      const result = await confirm(code.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBackupCodes(result.backupCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm the code — a network error occurred.");
    } finally {
      setConfirming(false);
    }
  }

  if (backupCodes) {
    return (
      <div className="card">
        <h1 style={{ fontSize: 18 }}>Save your backup codes</h1>
        <p className="muted" style={{ fontSize: 13.5 }}>
          If you ever lose access to your authenticator app, use one of these to sign in instead of the
          6-digit code. Each code works once. Store them somewhere safe — a password manager is ideal —
          this is the only time they&apos;ll be shown.
        </p>
        <div className="command-box" style={{ fontSize: 15, letterSpacing: 0.5 }}>
          {backupCodes.join("\n")}
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={savedCodes} onChange={(e) => setSavedCodes(e.target.checked)} style={{ width: "auto" }} />
            I&apos;ve saved these codes somewhere safe
          </label>
        </div>
        <button disabled={!savedCodes} onClick={onConfirmed} style={{ width: "100%" }}>
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h1 style={{ fontSize: 18 }}>Set up multi-factor authentication</h1>
      <p className="muted" style={{ fontSize: 13.5 }}>
        Scan this QR code with Google Authenticator, Microsoft Authenticator, or a similar app, then enter
        the 6-digit code it shows you to confirm.
      </p>
      {error && <div className="alert error">{error}</div>}
      {loading ? (
        <p className="muted">Generating your QR code…</p>
      ) : qrDataUrl ? (
        <>
          <div style={{ background: "#fff", padding: 12, borderRadius: 8, display: "inline-block", marginBottom: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="MFA setup QR code" width={200} height={200} />
          </div>
          {secretBase32 && (
            <p className="muted" style={{ fontSize: 12.5 }}>
              Can&apos;t scan it? Enter this code manually in your app: <code>{secretBase32}</code>
            </p>
          )}
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="mfa-code">6-digit code</label>
              <input
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                style={{ width: "100%" }}
              />
            </div>
            <button type="submit" disabled={confirming || code.trim().length !== 6} style={{ width: "100%" }}>
              {confirming ? "Confirming…" : "Confirm and enable MFA"}
            </button>
          </form>
        </>
      ) : null}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 16 }}>
        {doneMessage}
      </p>
    </div>
  );
}
