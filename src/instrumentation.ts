/**
 * Next.js server-startup hook (stable since Next 14.0.4 — no experimental
 * config flag needed on this project's 14.2.15). `register()` runs once
 * when the server process boots, before it starts handling requests.
 *
 * We use it for exactly one thing: starting the slow-query-history
 * background scanner (src/lib/slow-query-scanner.ts) so it's a real
 * server-side job tied to the app process, not to any browser tab being
 * open. It has to be gated to the Node.js runtime specifically — this
 * file also runs (a second time, with nothing useful to do) under the Edge
 * runtime for middleware, and we don't want to try opening MySQL/Prisma
 * connections there.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSlowQueryScanner } = await import("@/lib/slow-query-scanner");
    startSlowQueryScanner();
  }
}
