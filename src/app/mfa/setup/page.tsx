"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MfaSetupPanel from "@/components/MfaSetupPanel";

function MfaSetupInner() {
  const router = useRouter();
  const params = useSearchParams();

  async function begin() {
    const res = await fetch("/api/mfa/setup", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not start MFA setup.");
    return data;
  }

  async function confirm(code: string) {
    const res = await fetch("/api/mfa/setup/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false as const, error: data.error ?? "Could not confirm the code." };
    return { ok: true as const, backupCodes: data.backupCodes as string[] };
  }

  function onConfirmed() {
    router.push(params.get("next") ?? "/dashboard");
    router.refresh();
  }

  return (
    <MfaSetupPanel
      begin={begin}
      confirm={confirm}
      onConfirmed={onConfirmed}
      doneMessage="This is required before you can access the dashboard."
    />
  );
}

export default function MfaSetupPage() {
  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 64 }}>
      <Suspense fallback={null}>
        <MfaSetupInner />
      </Suspense>
    </div>
  );
}
