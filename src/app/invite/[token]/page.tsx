"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function InviteAcceptPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [invite, setInvite] = useState<{ username: string; name: string; email: string; role: string } | null>(null);
  const [invalidError, setInvalidError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/invite/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setInvalidError(data.error ?? "This invite is invalid or has expired.");
        else setInvite(data);
      })
      .catch(() => {
        if (!cancelled) setInvalidError("Could not check this invite — a network error occurred.");
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/invite/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not set your password.");
        return;
      }
      router.push(data.next ?? "/mfa/setup");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 64 }}>
      {checking ? (
        <div className="card">
          <p className="muted">Checking your invite…</p>
        </div>
      ) : invalidError ? (
        <div className="card">
          <div className="alert error">{invalidError}</div>
          <p className="muted" style={{ fontSize: 13 }}>
            Ask an admin to resend your invite from the Users page.
          </p>
        </div>
      ) : (
        <div className="card">
          <h1 style={{ fontSize: 18, marginTop: 0 }}>Welcome to Query Monitor</h1>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Set a password for <strong>{invite?.name}</strong> ({invite?.username}). Next you&apos;ll set up
            multi-factor authentication, which is required for every account.
          </p>
          {error && <div className="alert error">{error}</div>}
          <form onSubmit={onSubmit}>
            <div className="field">
              <label>Username</label>
              <input value={invite?.username ?? ""} disabled style={{ width: "100%" }} />
            </div>
            <div className="field">
              <label>Email</label>
              <input value={invite?.email ?? ""} disabled style={{ width: "100%" }} />
            </div>
            <div className="field">
              <label htmlFor="password">Password (at least 10 characters)</label>
              <input
                id="password"
                type="password"
                autoFocus
                required
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Confirm password</label>
              <input
                id="confirm-password"
                type="password"
                required
                minLength={10}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
            <button type="submit" disabled={submitting} style={{ width: "100%" }}>
              {submitting ? "Saving…" : "Continue to MFA setup"}
            </button>
          </form>
        </div>
      )}
      <Link href="/login" className="muted" style={{ display: "block", marginTop: 16, fontSize: 13, textAlign: "center" }}>
        ← Back to sign in
      </Link>
    </div>
  );
}
