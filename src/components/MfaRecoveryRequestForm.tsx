"use client";

import { useState } from "react";
import Link from "next/link";

export default function MfaRecoveryRequestForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/mfa/recovery-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      // Always show the same message, whether or not the email matched an
      // account — see the API route for why.
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h1 style={{ fontSize: 18, marginTop: 0 }}>Lost your device?</h1>
      <p className="muted" style={{ fontSize: 13.5 }}>
        Enter your account email and, if it has MFA enabled, we&apos;ll send a link that lets you set up a
        new authenticator app. It won&apos;t log you in by itself — you&apos;ll still need your password.
      </p>
      {sent ? (
        <div className="alert ok">
          If that email has an account with MFA enabled, a reset link is on its way. Check your inbox.
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="recovery-email">Email</label>
            <input
              id="recovery-email"
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: "100%" }}
            />
          </div>
          <button type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <Link href="/login" className="muted" style={{ display: "block", marginTop: 16, fontSize: 13, textAlign: "center" }}>
        ← Back to sign in
      </Link>
    </div>
  );
}
