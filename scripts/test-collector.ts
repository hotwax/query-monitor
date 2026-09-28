// Smoke test: fires a deliberately slow query as `order_svc` in the
// background, then runs the exact same collector the dashboard API uses
// and confirms the slow query shows up, ranked first.
import mysql from "mysql2/promise";
import { prisma } from "../src/lib/db";
import { collectAcrossConnections } from "../src/lib/mysql-collector";

async function main() {
  const connection = await prisma.dbConnection.findUnique({ where: { name: "local-demo-mysql" } });
  if (!connection) {
    throw new Error('No "local-demo-mysql" connection found — run `npm run seed` first.');
  }

  // Open a second, independent connection as the demo app user and hold it
  // busy for a while (SLEEP counts as a running query in PROCESSLIST).
  const slowConn = await mysql.createConnection({
    host: connection.host,
    port: connection.port,
    user: "order_svc",
    password: "order_svc_pw",
    database: "demo_shop",
  });
  const slowQueryPromise = slowConn.query("SELECT SLEEP(12) AS slept").finally(() => slowConn.end());

  // Give it a moment to actually register in PROCESSLIST.
  await new Promise((r) => setTimeout(r, 1500));

  const { queries, errors } = await collectAcrossConnections([connection], { minDurationSeconds: 0 });

  console.log(`Collector errors: ${errors.length === 0 ? "none" : JSON.stringify(errors)}`);
  console.log(`Queries observed: ${queries.length}`);
  queries.forEach((q, i) => {
    console.log(
      `  #${i + 1} pid=${q.processId} user=${q.dbUsername} db=${q.database} duration=${q.durationSeconds}s state=${q.state} query=${q.queryText}`
    );
  });

  const slow = queries.find((q) => q.dbUsername === "order_svc" && (q.queryText ?? "").includes("SLEEP"));
  if (!slow) {
    throw new Error("FAIL: the SLEEP(12) query from order_svc was not detected by the collector.");
  }
  if (queries[0].processId !== slow.processId) {
    throw new Error("FAIL: the longest-running query is not sorted first.");
  }
  console.log("PASS: long-running query detected and correctly ranked first.");

  await slowQueryPromise.catch(() => undefined); // let the SLEEP finish so the process exits cleanly
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
