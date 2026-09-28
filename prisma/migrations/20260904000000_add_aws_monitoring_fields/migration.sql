-- Adds the two fields the new "Monitoring" page needs to map a registered
-- DB Machine to its AWS CloudWatch identity. Both are nullable/defaulted,
-- so this is a plain additive change — safe against existing rows, no
-- backfill required (existing machines just start out "not configured for
-- AWS monitoring" until an admin fills these in from the DB Machines page).

ALTER TABLE "DbConnection" ADD COLUMN "awsDbInstanceIdentifier" TEXT;
ALTER TABLE "DbConnection" ADD COLUMN "isReadReplica" BOOLEAN NOT NULL DEFAULT false;
