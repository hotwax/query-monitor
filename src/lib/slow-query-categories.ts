/**
 * Severity tiers for the slow-query history log (see "Query History" nav
 * page). Deliberately not the same thing as the Dashboard's "long-running"
 * threshold (5s by default, LONG_QUERY_THRESHOLD_SECONDS) — that's about
 * what's worth glancing at RIGHT NOW; this is about what's worth keeping a
 * permanent record of. Boundaries agreed on directly with the team: a
 * query only starts showing up here once it's run 30 minutes, and the top
 * tier is open-ended so nothing past 3 hours falls through a gap.
 */
export type DurationCategory = "WARNING" | "LONG" | "CRITICAL" | "SEVERE";

export const DURATION_CATEGORIES: { value: DurationCategory; label: string; minMinutes: number; maxMinutes: number | null }[] = [
  { value: "WARNING", label: "Warning (30–60 min)", minMinutes: 30, maxMinutes: 60 },
  { value: "LONG", label: "Long (1–2 hr)", minMinutes: 60, maxMinutes: 120 },
  { value: "CRITICAL", label: "Critical (2–3 hr)", minMinutes: 120, maxMinutes: 180 },
  { value: "SEVERE", label: "Severe (3 hr+)", minMinutes: 180, maxMinutes: null },
];

/** The lowest duration (in seconds) this log tracks at all — anything under this is never recorded. */
export const MIN_TRACKED_DURATION_SECONDS = 30 * 60;

export function isDurationCategory(value: string): value is DurationCategory {
  return DURATION_CATEGORIES.some((c) => c.value === value);
}

/** Which tier a duration falls into. Durations under the 30-minute floor have no category — callers should have already filtered those out. */
export function categorizeDuration(seconds: number): DurationCategory {
  const minutes = seconds / 60;
  if (minutes >= 180) return "SEVERE";
  if (minutes >= 120) return "CRITICAL";
  if (minutes >= 60) return "LONG";
  return "WARNING";
}

export function categoryLabel(category: string): string {
  return DURATION_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

/** "1 hr 24 min" / "42 min" — the actual elapsed time, shown alongside the category badge rather than instead of it. */
export function formatDurationLong(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}
