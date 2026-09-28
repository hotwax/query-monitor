import { decryptSecret } from "@/lib/crypto";
import type { DbConnection } from "@prisma/client";

/**
 * Resolves the credential for the DEDICATED kill account used to build
 * "Kill Query" commands.
 *
 * This is deliberately a SEPARATE account from any application/service DB
 * user — see prisma/rds-kill-user.sql for why: killing a query started by a
 * different MySQL user requires CONNECTION_ADMIN/SUPER (or, on RDS/Aurora,
 * the built-in mysql.rds_kill / mysql.rds_kill_query procedures), and AWS
 * does not allow granting CONNECTION_ADMIN/SUPER to a regular RDS user on
 * current MySQL/Aurora versions. So rather than storing every individual
 * application user's own real login password (which only works when you're
 * killing that exact user's own query, and still needs to be captured and
 * stored somewhere), this app uses ONE narrowly-scoped account — able to see
 * every session (PROCESS) and end any session (EXECUTE on the two RDS
 * kill procedures) but nothing else: no table data access, no ability to
 * create/alter users, no broader admin rights.
 *
 * Most setups use ONE shared kill account across every RDS/Aurora instance,
 * supplied via the KILL_DB_USERNAME / KILL_DB_PASSWORD environment
 * variables (set them in your .env / docker-compose environment — nothing
 * is typed into the admin UI for this by default). If a specific DB Machine
 * needs its own kill account instead, set a per-connection override from
 * the DB Machines admin page — that takes precedence.
 */
export function resolveKillCredentials(
  connection: Pick<DbConnection, "killUsername" | "killPasswordEnc">
): { username: string; password: string } {
  if (connection.killUsername && connection.killPasswordEnc) {
    return {
      username: connection.killUsername,
      password: decryptSecret(connection.killPasswordEnc),
    };
  }

  const envUsername = process.env.KILL_DB_USERNAME;
  const envPassword = process.env.KILL_DB_PASSWORD;

  if (!envUsername || !envPassword) {
    throw new Error(
      "No kill account credential available for this DB Machine. Either set " +
        "KILL_DB_USERNAME / KILL_DB_PASSWORD in the environment, or give this " +
        "machine its own override under DB Machines."
    );
  }

  return { username: envUsername, password: envPassword };
}
