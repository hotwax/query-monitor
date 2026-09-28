import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function upsertUser(
  username: string,
  name: string,
  email: string,
  password: string,
  role: "DEVELOPER" | "DEVOPS" | "ADMIN"
) {
  const passwordHash = await bcrypt.hash(password, 10);
  // Deliberately does NOT touch mfaEnabled/mfaSecretEnc on `update` — if
  // you've already set MFA up on a re-seeded account, re-running seed
  // shouldn't rip it out from under you. A brand-new row starts with
  // mfaEnabled=false (the column default), same as every other account, so
  // it goes through forced MFA setup the first time you log in with it.
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role, username, name, status: "ACTIVE" },
    create: { username, name, email, passwordHash, role, status: "ACTIVE" },
  });
  console.log(`  user  ${username.padEnd(10)} ${email.padEnd(28)} role=${role.padEnd(9)} password=${password}`);
}

async function main() {
  console.log("Seeding demo accounts (change these passwords before real use):");
  console.log("  Every account still has to go through MFA setup on its first login — see README.");
  await upsertUser("admin", "Admin", "admin@hotwax.co", "ChangeMe!Admin1", "ADMIN");
  await upsertUser("devops", "DevOps", "devops@hotwax.co", "ChangeMe!DevOps1", "DEVOPS");
  await upsertUser("dev", "Developer", "dev@hotwax.co", "ChangeMe!Dev1", "DEVELOPER");

  // Demo DB machine — points at whichever MySQL/MariaDB instance you're
  // testing against (DEMO_DB_HOST/DEMO_DB_PORT env vars — e.g. your local
  // MariaDB from scripts/setup-local-mysql.sh, or a real test instance).
  // No monitor username/password here: this connection deliberately relies
  // on the shared MONITOR_DB_USERNAME / MONITOR_DB_PASSWORD env vars (see
  // src/lib/monitor-credentials.ts) — the read-only user you create
  // yourself with prisma/rds-readonly-user.sql. Add a new machine from the
  // admin UI to point at a different/real instance instead of editing this.
  const demoHost = process.env.DEMO_DB_HOST ?? "127.0.0.1";
  const demoPort = Number(process.env.DEMO_DB_PORT ?? 3306);
  // If you're running seed against a container-only hostname (typically
  // "host.docker.internal" for local Docker testing), DEMO_KILL_CMD_HOST
  // lets the generated kill command show a host YOU can actually reach
  // from your own terminal instead — see the killCommandHost doc comment
  // in prisma/schema.prisma.
  const demoKillCmdHost = process.env.DEMO_KILL_CMD_HOST || null;

  const connection = await prisma.dbConnection.upsert({
    where: { name: "local-demo-mysql" },
    update: { host: demoHost, port: demoPort, killCommandHost: demoKillCmdHost },
    create: {
      name: "local-demo-mysql",
      host: demoHost,
      port: demoPort,
      killCommandHost: demoKillCmdHost,
      notes: "Uses the shared MONITOR_DB_USERNAME/MONITOR_DB_PASSWORD env vars — see scripts/setup-local-mysql.sh",
    },
  });
  console.log(
    `  connection local-demo-mysql -> ${demoHost}:${demoPort} (monitor + kill creds from env)` +
      (demoKillCmdHost ? `, kill commands will show host=${demoKillCmdHost}` : "")
  );
  console.log(
    "  NOTE: kill commands need KILL_DB_USERNAME/KILL_DB_PASSWORD set (see prisma/rds-kill-user.sql) " +
      "and MONITOR_DB_USERNAME/MONITOR_DB_PASSWORD for the dashboard to show anything at all."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
