"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MfaSetupPanel from "@/components/MfaSetupPanel";

export default function MfaRecoveryTokenPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [checking, setChecking] = useState(true);
  const [validFor, setValidFor] = useState<{ name: string; email: string } | null>(null);
  const [invalidError, setInvalidError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/mfa/recovery/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setInvalidError(data.error ?? "This link is invalid or has expired.");
        } else {
          setValidFor({ name: data.name, email: data.email });
        }
      })
      .catch(() => {
        if (!cancelled) setInvalidError("Could not check this link — a network error occurred.");
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function begin() {
    const res = await fetch(`/api/mfa/recovery/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "begin" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not start MFA setup.");
    return data;
  }

  async function confirm(code: string) {
    const res = await fetch(`/api/mfa/recovery/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm", code }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false as const, error: data.error ?? "Could not confirm the code." };
    return { ok: true as const, backupCodes: data.backupCodes as string[] };
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 64 }}>
      {checking ? (
        <div className="card">
          <p className="muted">Checking your link…</p>
        </div>
      ) : invalidError ? (
        <div className="card">
          <div className="alert error">{invalidError}</div>
          <Link href="/mfa/recovery" className="muted">
            Request a new reset link
          </Link>
        </div>
      ) : done ? (
        <div className="card">
          <div className="alert ok">✓ MFA has been reset for {validFor?.name}.</div>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Your new authenticator app is set up. Sign in with your password as usual — you&apos;ll be
            asked for a code from it.
          </p>
          <Link href="/login">
            <button style={{ width: "100%" }}>Go to sign in</button>
          </Link>
        </div>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
            Resetting MFA for <strong>{validFor?.name}</strong> ({validFor?.email})
          </p>
          <MfaSetupPanel
            begin={begin}
            confirm={confirm}
            onConfirmed={() => setDone(true)}
            doneMessage="This replaces your old authenticator app entirely — the old one will stop working."
          />
        </>
      )}
    </div>
  );
}
