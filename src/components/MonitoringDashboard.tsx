"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface MachineOption {
  id: string;
  name: string;
  isReadReplica: boolean;
  monitoringConfigured: boolean;
}

interface MetricSeries {
  name: string;
  label: string;
  unit: string;
  points: { timestamp: string; value: number }[];
  empty: boolean;
}

interface MetricsResponse {
  configured: boolean;
  message?: string;
  error?: string;
  connectionName?: string;
  isReadReplica?: boolean;
  region?: string;
  dbInstanceIdentifier?: string;
  range?: string;
  metrics?: MetricSeries[];
}

const RANGE_OPTIONS = [
  { label: "1h", value: "1h" },
  { label: "3h", value: "3h" },
  { label: "12h", value: "12h" },
  { label: "1d", value: "1d" },
];

// CloudWatch itself only updates most AWS/RDS metrics once a minute, so
// polling faster than this just burns API calls for no new data.
const REFRESH_MS = 60000;

function formatUnit(unit: string, value: number): string {
  if (unit === "Bytes") {
    // FreeableMemory / FreeStorageSpace come back in raw bytes — GiB reads
    // far better than a 10-digit number.
    return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  }
  if (unit === "Percent") return `${value.toFixed(1)}%`;
  if (unit === "Seconds") return `${value.toFixed(3)}s`;
  if (unit === "Count/Second") return `${value.toFixed(1)}/s`;
  return value.toFixed(1);
}

function axisValue(unit: string, value: number): number {
  if (unit === "Bytes") return Number((value / 1024 ** 3).toFixed(2));
  return Number(value.toFixed(2));
}

function MetricChart({ metric }: { metric: MetricSeries }) {
  const data = useMemo(
    () =>
      metric.points.map((p) => ({
        time: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        value: axisValue(metric.unit, p.value),
      })),
    [metric]
  );

  return (
    <div className="card">
      <p className="section-title" style={{ marginBottom: 2 }}>
        {metric.label}
      </p>
      {metric.empty ? (
        <p className="muted" style={{ fontSize: 13 }}>
          No datapoints in this time range.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>
            {formatUnit(metric.unit, metric.points[metric.points.length - 1].value)}
            <span className="muted" style={{ fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
              latest
            </span>
          </p>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={30} />
              <YAxis tick={{ fontSize: 10 }} width={44} />
              <Tooltip
                formatter={(value) => {
                  const n = typeof value === "number" ? value : Number(value);
                  return formatUnit(metric.unit, metric.unit === "Bytes" ? n * 1024 ** 3 : n);
                }}
                contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", fontSize: 12 }}
              />
              <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

export default function MonitoringDashboard() {
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [awsConfigured, setAwsConfigured] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [range, setRange] = useState("1h");
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadMachines = useCallback(async () => {
    const res = await fetch("/api/monitoring/machines");
    const json = await res.json();
    setAwsConfigured(json.awsConfigured ?? false);
    setMachines(json.machines ?? []);
    setSelectedId((current) => current ?? json.machines?.[0]?.id ?? null);
  }, []);

  useEffect(() => {
    loadMachines();
  }, [loadMachines]);

  const loadMetrics = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/monitoring/metrics?connectionId=${selectedId}&range=${range}`);
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, [selectedId, range]);

  useEffect(() => {
    loadMetrics();
    const interval = setInterval(loadMetrics, REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadMetrics]);

  const selectedMachine = machines.find((m) => m.id === selectedId);

  return (
    <div>
      <div className="card" style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <label style={{ fontSize: 12, display: "block", marginBottom: 4 }} className="muted">
            Database machine
          </label>
          <select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)} style={{ minWidth: 220 }}>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.isReadReplica ? " (replica)" : " (primary)"}
                {!m.monitoringConfigured ? " — not configured" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, display: "block", marginBottom: 4 }} className="muted">
            Time range
          </label>
          <div style={{ display: "flex", gap: 4 }}>
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.value}
                className={r.value === range ? "" : "secondary"}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {lastUpdated && (
            <span className="muted" style={{ fontSize: 12 }}>
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button className="secondary" onClick={loadMetrics} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {!awsConfigured && (
        <div className="alert warn">
          AWS monitoring isn&apos;t configured yet — an admin needs to add{" "}
          <code>AWS_ACCESS_KEY_ID</code>, <code>AWS_SECRET_ACCESS_KEY</code> and{" "}
          <code>AWS_REGION</code> to the app&apos;s environment. See README → &quot;AWS CloudWatch
          monitoring&quot;.
        </div>
      )}

      {machines.length === 0 && (
        <div className="alert warn">No database machines registered yet — add one from DB Machines.</div>
      )}

      {selectedMachine && !selectedMachine.monitoringConfigured && awsConfigured && (
        <div className="alert warn">
          &quot;{selectedMachine.name}&quot; doesn&apos;t have an AWS RDS DB instance identifier set
          yet. An admin can add one from the DB Machines page to enable monitoring for it.
        </div>
      )}

      {data && !data.configured && data.message && <div className="alert warn">{data.message}</div>}
      {data?.error && <div className="alert error">{data.error}</div>}

      {data?.configured && data.metrics && data.metrics.every((m) => m.empty) && (
        <div className="alert warn">
          CloudWatch answered but returned no datapoints for <strong>any</strong> metric on this
          machine (queried region <code>{data.region}</code>, identifier{" "}
          <code>{data.dbInstanceIdentifier}</code>). That almost always means the AWS DB instance
          identifier or region set for this machine on the DB Machines page doesn&apos;t exactly
          match what&apos;s in the RDS console for it — CloudWatch doesn&apos;t error on an
          unknown identifier, it just returns nothing. Double-check both against the instance&apos;s
          &quot;Configuration&quot; tab in the AWS console.
        </div>
      )}

      {data?.configured && data.metrics && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          {data.metrics.map((m) => (
            <MetricChart key={m.name} metric={m} />
          ))}
        </div>
      )}
    </div>
  );
}
