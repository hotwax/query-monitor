-- Adds the "Query History" feature: a per-machine opt-in flag, and a new
-- table that the background scanner (src/lib/slow-query-scanner.ts) writes
-- to. Both are purely additive against existing data — the new column is
-- defaulted, and SlowQueryLog is a brand new table — so this is safe to
-- run against a database with existing DbConnection rows.

ALTER TABLE "DbConnection" ADD COLUMN "slowQueryTrackingEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SlowQueryLog" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "connectionName" TEXT NOT NULL,
    "databaseName" TEXT,
    "dbUsername" TEXT NOT NULL,
    "clientHost" TEXT,
    "queryText" TEXT,
    "processId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maxDurationSeconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlowQueryLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SlowQueryLog_firstDetectedAt_idx" ON "SlowQueryLog"("firstDetectedAt");
CREATE INDEX "SlowQueryLog_connectionId_processId_status_idx" ON "SlowQueryLog"("connectionId", "processId", "status");
CREATE INDEX "SlowQueryLog_databaseName_idx" ON "SlowQueryLog"("databaseName");
CREATE INDEX "SlowQueryLog_category_idx" ON "SlowQueryLog"("category");

ALTER TABLE "SlowQueryLog" ADD CONSTRAINT "SlowQueryLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "DbConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
