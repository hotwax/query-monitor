/** @type {import('next').NextConfig} */
const nextConfig = {
  // Kept default; server-only secrets are read via process.env at request time.
  experimental: {
    // Required on Next 14.x for src/instrumentation.ts (register()) to
    // actually run — it's what starts the slow-query-history background
    // scanner when the server boots. Verified this is off by default on
    // this project's Next 14.2.15 (it only became on-by-default in Next
    // 15) by checking next.config's instrumentationHookEnabled check and
    // confirming .next/required-server-files.json said "instrumentationHook":
    // false without this. Safe to remove if/when this project upgrades to
    // Next 15+, where it's no longer an experimental flag.
    instrumentationHook: true,
  },
};

export default nextConfig;
