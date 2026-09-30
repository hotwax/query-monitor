import { prisma } from "@/lib/db";

/**
 * App-wide settings that live in the database instead of environment
 * variables — the whole point being that they can be changed from inside
 * the app itself (see the "Query History settings" card on the DB Machines
 * page) without editing .env or restarting/recreating the container. This
 * is the ONLY module that should touch the AppSettings table directly —
 * everything else calls these helpers.
 *
 * There is always exactly one row, at a fixed id ("global"). Reads that
 * find no row yet (a brand-new install, or an existing one that's never
 * saved a value through the UI) fall back to whatever
 * SLOW_QUERY_MIN_DURATION_SECONDS was set to in the environment — so
 * upgrading this app doesn't silently reset an already-tuned threshold
 * back to the 30-minute default the moment this ships. The first time
 * anyone saves a new value from the UI, a real row is created and the env
 * var stops being consulted from then on.
 */

const SETTINGS_ID = "global";
const DEFAULT_SLOW_QUERY_MIN_DURATION_SECONDS = 30 * 60;

function envFallbackMinDurationSeconds(): number {
  const raw = process.env.SLOW_QUERY_MIN_DURATION_SECONDS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SLOW_QUERY_MIN_DURATION_SECONDS;
}

/**
 * The current Query History floor, in seconds — read fresh from the
 * database on every call (the background scanner calls this once per scan
 * cycle, see src/lib/slow-query-scanner.ts), so a change saved from the UI
 * takes effect within one scan interval rather than needing a restart.
 */
export async function getSlowQueryMinDurationSeconds(): Promise<number> {
  const row = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { slowQueryMinDurationSeconds: true },
  });
  return row?.slowQueryMinDurationSeconds ?? envFallbackMinDurationSeconds();
}

export async function setSlowQueryMinDurationSeconds(seconds: number): Promise<number> {
  const row = await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { slowQueryMinDurationSeconds: seconds },
    create: { id: SETTINGS_ID, slowQueryMinDurationSeconds: seconds },
  });
  return row.slowQueryMinDurationSeconds;
}
