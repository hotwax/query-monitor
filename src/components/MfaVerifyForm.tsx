"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

export default function MfaVerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useBackupCode ? { backupCode: code.trim() } : { code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not verify that code.");
        return;
      }
      router.push(params.get("next") ?? "/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h1 style={{ fontSize: 18, marginTop: 0 }}>Enter your authenticator code</h1>
      <p className="muted" style={{ fontSize: 13.5 }}>
        Open your authenticator app and enter the 6-digit code it&apos;s showing.
      </p>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="mfa-code">{useBackupCode ? "Backup code" : "6-digit code"}</label>
          <input
            id="mfa-code"
            autoFocus
            inputMode={useBackupCode ? "text" : "numeric"}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={useBackupCode ? "XXXX-XXXX" : "123456"}
            style={{ width: "100%" }}
          />
        </div>
        <button type="submit" disabled={loading || !code.trim()} style={{ width: "100%" }}>
          {loading ? "Verifying…" : "Verify"}
        </button>
      </form>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setUseBackupCode(!useBackupCode);
            setCode("");
            setError(null);
          }}
        >
          {useBackupCode ? "Use my authenticator app instead" : "Use a backup code instead"}
        </button>
        <Link href="/mfa/recovery" className="muted" style={{ textAlign: "center", marginTop: 4 }}>
          Lost your device and your backup codes? Get a reset link by email
        </Link>
      </div>
    </div>
  );
}
