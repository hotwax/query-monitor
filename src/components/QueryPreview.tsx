"use client";

import { useEffect, useRef, useState } from "react";

/** Copies text to the clipboard. navigator.clipboard only exists in secure
 * contexts (https or localhost) — an on-prem install served over plain http
 * wouldn't have it, so fall back to the old textarea + execCommand trick. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the fallback below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = "Copy", title }: { text: string; label?: string; title?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function onClick() {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button type="button" className="copy-btn" onClick={onClick} title={title ?? "Copy to clipboard"}>
      {state === "copied" ? "Copied" : state === "failed" ? "Failed" : label}
    </button>
  );
}

/** What the "View query" popup shows. Captured as a snapshot at click time
 * (not a live reference to the row), so the popup stays put even if the
 * query finishes and drops off the dashboard while it's being read. */
export interface ViewQueryTarget {
  processId: number;
  title?: string;
  meta: string;
  queryText: string;
}

/** Compact, horizontally-wrapped preview (a few lines max) with a link to
 * open the whole thing. Keeps very long production queries from taking
 * over the screen vertically. */
export function QueryPreview({ text, onView }: { text: string | null; onView: () => void }) {
  if (!text) return <span className="muted">(no text captured)</span>;
  return (
    <div>
      <div className="query-preview">{text}</div>
      <button type="button" className="link-btn" onClick={onView}>
        View query
      </button>
    </div>
  );
}

export function ViewQueryModal({ target, onClose }: { target: ViewQueryTarget; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-wide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2>{target.title ?? `Query #${target.processId}`}</h2>
            <p className="muted" style={{ fontSize: 13, margin: "0 0 14px" }}>
              {target.meta}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <CopyButton text={target.queryText} label="Copy query" />
            <button type="button" className="secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="query-full">{target.queryText}</div>
      </div>
    </div>
  );
}
