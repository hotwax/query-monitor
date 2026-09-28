import { decryptSecret } from "@/lib/crypto";
import type { DbConnection } from "@prisma/client";

/**
 * Resolves the read-only monitoring credential used to poll a DB Machine.
 *
 * Most setups use ONE shared read-only user (created by your own DBA/DevOps
 * team — see prisma/rds-readonly-user.sql) across every RDS/Aurora instance,
 * supplied via the MONITOR_DB_USERNAME / MONITOR_DB_PASSWORD environment
 * variables (set them in your .env / docker-compose environment — nothing
 * is typed into the admin UI for this by default).
 *
 * If a specific DB Machine was instead given its own username/password
 * through the admin UI (useful when one instance needs a differently named
 * or scoped read-only user), that per-connection value takes precedence.
 */
export function resolveMonitorCredentials(
  connection: Pick<DbConnection, "monitorUsername" | "monitorPasswordEnc">
): { username: string; password: string } {
  if (connection.monitorUsername && connection.monitorPasswordEnc) {
    return {
      username: connection.monitorUsername,
      password: decryptSecret(connection.monitorPasswordEnc),
    };
  }

  const envUsername = process.env.MONITOR_DB_USERNAME;
  const envPassword = process.env.MONITOR_DB_PASSWORD;

  if (!envUsername || !envPassword) {
    throw new Error(
      "No read-only monitoring credential available for this DB Machine. Either set " +
        "MONITOR_DB_USERNAME / MONITOR_DB_PASSWORD in the environment, or give this " +
        "machine its own override under DB Machines."
    );
  }

  return { username: envUsername, password: envPassword };
}
