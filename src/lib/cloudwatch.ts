import {
  CloudWatchClient,
  GetMetricDataCommand,
  type MetricDataQuery,
} from "@aws-sdk/client-cloudwatch";

/**
 * AWS CloudWatch metrics for the "Monitoring" nav page — deliberately just
 * CloudWatch's standard AWS/RDS metrics (CPU, connections, storage, IOPS,
 * latency, ReplicaLag), NOT Performance Insights ("DB Load" and friends).
 * DB Load is a separate feature/API (has to be enabled per instance, and
 * keyed by a different identifier, DbiResourceId) — deliberately left out
 * for now; see README "AWS CloudWatch monitoring" section.
 *
 * Auth: a plain AWS IAM user access key/secret in .env (AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY / AWS_REGION), read server-side only — never sent
 * to the browser, same philosophy as every other credential in this app.
 * That IAM user only needs read-only CloudWatch access; see README for the
 * exact policy.
 */

export interface MetricDefinition {
  /** CloudWatch metric name in the AWS/RDS namespace, e.g. "CPUUtilization". */
  name: string;
  /** Human label shown above the chart. */
  label: string;
  unit: string;
  /** CloudWatch statistic to request — "Average" for almost everything here. */
  statistic: "Average" | "Maximum" | "Sum";
  /** Only meaningful for a read replica (e.g. ReplicaLag doesn't exist on a primary). */
  replicaOnly?: boolean;
}

// Ordered most-important-first, per how you'd actually triage an incident —
// NOT the ~20-metric AWS console default. ReplicaLag is injected at the
// front for replicas specifically (see metricsForMachine below); everything
// else applies to both primary and replica instances.
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { name: "ReplicaLag", label: "Replica Lag", unit: "Seconds", statistic: "Average", replicaOnly: true },
  { name: "CPUUtilization", label: "CPU Utilization", unit: "Percent", statistic: "Average" },
  { name: "DatabaseConnections", label: "Database Connections", unit: "Count", statistic: "Average" },
  { name: "FreeableMemory", label: "Freeable Memory", unit: "Bytes", statistic: "Average" },
  { name: "FreeStorageSpace", label: "Free Storage Space", unit: "Bytes", statistic: "Average" },
  { name: "ReadLatency", label: "Read Latency", unit: "Seconds", statistic: "Average" },
  { name: "WriteLatency", label: "Write Latency", unit: "Seconds", statistic: "Average" },
  { name: "ReadIOPS", label: "Read IOPS", unit: "Count/Second", statistic: "Average" },
  { name: "WriteIOPS", label: "Write IOPS", unit: "Count/Second", statistic: "Average" },
];

/** The definitions relevant to one machine, in display order. */
export function metricsForMachine(isReadReplica: boolean): MetricDefinition[] {
  return METRIC_DEFINITIONS.filter((m) => (m.replicaOnly ? isReadReplica : true));
}

export interface MetricSeries {
  name: string;
  label: string;
  unit: string;
  points: { timestamp: string; value: number }[];
  /** True if CloudWatch returned no datapoints at all for this metric+range (e.g. ReplicaLag on an instance with no traffic, or a too-new instance). */
  empty: boolean;
}

// CloudWatch calls are always scoped to one region per request, and
// different DB Machines can genuinely live in different regions (e.g. prod
// + replicas in one region, UAT in another) — so this caches one client
// per region actually used, rather than a single global singleton.
const clientsByRegion = new Map<string, CloudWatchClient>();

function getClient(region: string): CloudWatchClient {
  const existing = clientsByRegion.get(region);
  if (existing) return existing;
  const created = new CloudWatchClient({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  clientsByRegion.set(region, created);
  return created;
}

/** True once the credentials needed to call CloudWatch are present (a region is supplied per-call — see resolveRegion). */
export function awsMonitoringConfigured(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

/**
 * A machine's own `awsRegion` override wins if set (different machines can
 * live in different regions); otherwise falls back to the app-wide
 * AWS_REGION env var. Returns null if neither is set — the caller should
 * treat that as "not configured" for this machine rather than guessing.
 */
export function resolveRegion(machineAwsRegion: string | null | undefined): string | null {
  return machineAwsRegion || process.env.AWS_REGION || null;
}

// A stable, CloudWatch-safe id ("^[a-z][a-zA-Z0-9_]*$") for each query in
// the batch, so we can match responses back to their metric definition
// without relying on result ordering.
function queryId(metricName: string): string {
  return `m_${metricName.replace(/[^a-zA-Z0-9_]/g, "")}`;
}

/**
 * Fetches every relevant metric for one DB instance in a single CloudWatch
 * GetMetricData call (batched — this is both cheaper and faster than one
 * call per metric; GetMetricData allows up to 500 queries per request, and
 * we only ever send ~9).
 */
export async function fetchMachineMetrics(params: {
  dbInstanceIdentifier: string;
  isReadReplica: boolean;
  /** Resolved region (this machine's override, or the app-wide default) — see resolveRegion(). */
  region: string;
  startTime: Date;
  endTime: Date;
  /** Granularity in seconds — must be a CloudWatch-valid period (60, 300, ...). */
  periodSeconds: number;
}): Promise<MetricSeries[]> {
  const definitions = metricsForMachine(params.isReadReplica);

  const queries: MetricDataQuery[] = definitions.map((def) => ({
    Id: queryId(def.name),
    MetricStat: {
      Metric: {
        Namespace: "AWS/RDS",
        MetricName: def.name,
        Dimensions: [{ Name: "DBInstanceIdentifier", Value: params.dbInstanceIdentifier }],
      },
      Period: params.periodSeconds,
      Stat: def.statistic,
    },
    Label: def.label,
    ReturnData: true,
  }));

  const command = new GetMetricDataCommand({
    StartTime: params.startTime,
    EndTime: params.endTime,
    MetricDataQueries: queries,
    ScanBy: "TimestampAscending",
  });

  const response = await getClient(params.region).send(command);
  const results = response.MetricDataResults ?? [];

  return definitions.map((def) => {
    const result = results.find((r) => r.Id === queryId(def.name));
    const timestamps = result?.Timestamps ?? [];
    const values = result?.Values ?? [];
    const points = timestamps.map((ts, i) => ({
      timestamp: ts.toISOString(),
      value: values[i],
    }));
    return {
      name: def.name,
      label: def.label,
      unit: def.unit,
      points,
      empty: points.length === 0,
    };
  });
}
