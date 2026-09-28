"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed.");
        return;
      }
      // Password checked out, but that's never enough on its own — the
      // server tells us whether this account still needs to verify an
      // existing authenticator (next="/mfa/verify") or set one up for the
      // first time (next="/mfa/setup"). Either way we're not actually
      // logged in yet, so the originally-requested "next" page (if any)
      // gets carried along as a query param and picked up after MFA.
      const dest = data.next ?? "/dashboard";
      const afterMfa = params.get("next");
      router.push(afterMfa ? `${dest}?next=${encodeURIComponent(afterMfa)}` : dest);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Query Monitor</h1>
      <p className="muted" style={{ marginTop: -8, fontSize: 13 }}>
        Sign in with your developer or DevOps account.
      </p>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: "100%" }}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: "100%" }}
          />
        </div>
        <button type="submit" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
