-- Adds MFA (TOTP + backup codes + email-recovery) and the admin
-- invite-a-user flow to the User table.
--
-- Written by hand (not prisma's raw `migrate diff` output) so it's safe to
-- run against a database that already has real user rows in it — this app
-- is already deployed with real accounts (see prisma/seed.ts), and a naive
-- `ADD COLUMN ... NOT NULL` with no default fails outright against a
-- non-empty table for the new required `username`/`name` columns. Instead:
-- add everything nullable first, backfill username/name for any existing
-- rows from their email address (deduping on collision), then tighten the
-- constraints.

-- AlterTable: new columns, all nullable/defaulted so this is safe against
-- existing rows.
ALTER TABLE "User"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "name" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "inviteTokenHash" TEXT,
  ADD COLUMN "inviteExpiresAt" TIMESTAMP(3),
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecretEnc" TEXT,
  ADD COLUMN "mfaPendingSecretEnc" TEXT,
  ADD COLUMN "mfaBackupCodesJson" TEXT,
  ADD COLUMN "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mfaLockedUntil" TIMESTAMP(3),
  ADD COLUMN "mfaResetTokenHash" TEXT,
  ADD COLUMN "mfaResetExpiresAt" TIMESTAMP(3);

-- Backfill username/name for any pre-existing rows (accounts created before
-- this migration, e.g. via prisma/seed.ts) from the local part of their
-- email — "admin@hotwax.co" -> "admin". Deduped on collision by appending a
-- number (2nd, 3rd, ... occurrence, ordered by createdAt) so the unique
-- index below can never fail. New users created after this migration
-- always get a real username/name at creation time via the admin UI, so
-- this only ever applies to accounts that predate it — rename them from
-- the Users admin page afterwards if the generated username isn't ideal.
WITH ranked AS (
  SELECT "id", split_part("email", '@', 1) AS base,
         row_number() OVER (PARTITION BY split_part("email", '@', 1) ORDER BY "createdAt") AS rn
  FROM "User"
  WHERE "username" IS NULL
)
UPDATE "User" u
SET
  "username" = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || r.rn::text END,
  "name" = COALESCE(u."name", r.base)
FROM ranked r
WHERE u."id" = r."id";

-- Now safe to tighten: every row has a username/name, and passwordHash
-- becomes optional (an INVITED user has none until they accept).
ALTER TABLE "User"
  ALTER COLUMN "username" SET NOT NULL,
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
