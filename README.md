# Query Monitor

An internal platform for spotting long-running / locked MySQL queries on RDS
and Aurora, without a DevOps engineer having to be the only person who can
look. Built to replace the "check RDS Performance Insights, or SSH in and
run `SHOW PROCESSLIST` by hand, then paste the query to a developer in
Slack" routine.

- **Everyone who logs in** (developer or DevOps) sees the same live
  dashboard: every currently-running query across your registered database
  machines, sorted longest-running first, with the database, the DB user
  running it, the client host, and the query text.
- **Locked/blocked queries get their own section, at the top** — a session
  stuck waiting on a lock another session is holding. This catches the
  classic real-world villain that "long-running queries" alone completely
  misses: a connection that ran one statement, took a lock, and then just
  sits there without committing — it looks perfectly idle (nothing shows up
  as slow), while everything queued behind its lock silently piles up. See
  "Locked / blocked queries" below.
- **DevOps/Admin accounts only** get a "Kill Query" button. It takes you to a
  page showing full query details, then — behind an AWS-style typed
  confirmation ("type confirm to proceed") — actually terminates the
  session, using AWS RDS/Aurora's built-in `mysql.rds_kill` procedure via a
  single, dedicated, narrowly-scoped **kill account** (`PROCESS` + `EXECUTE`
  on `mysql.rds_kill`/`mysql.rds_kill_query`, no data access — see
  `prisma/rds-kill-user.sql`), never as the query's own DB user or a broad
  admin account. No password or command is ever shown to you — the kill
  account's credentials never leave the server.
- The app only ever talks to your databases with two dedicated accounts
  that **you create yourself**: a **read-only** monitoring user (`PROCESS` +
  `performance_schema SELECT` — `prisma/rds-readonly-user.sql`) and the kill
  account above — both handed to the app purely as environment variables,
  never typed into the app's UI. Neither can read your table data.
- Every login and every step of a kill attempt — opening the kill page,
  checking status, and the kill itself (succeeded or failed) — is written to
  an append-only audit log, visible to DevOps/Admin on the **Kill Log** page.
- **Every account requires MFA** (TOTP — Google Authenticator, Microsoft
  Authenticator, or any compatible app), enforced right after password
  login with no way to skip it — see "Multi-factor authentication" below.
- **There's no self-service signup.** An Admin invites people from the
  **Users** page (username, name, email, role); they get an emailed link to
  set their own password and MFA app — see "Users & invites" below.
- Ships with a `Dockerfile` + `docker-compose.yml` — `docker compose up` is
  the intended way to run this.

## How it works

```
Developer/DevOps browser
        │  (session cookie, signed JWT)
        ▼
Next.js app (Docker) ──reads──▶ Postgres (Docker) — users, DB machine
   │                             registry, encrypted overrides, audit log
   │
   └──polls (read-only, using MONITOR_DB_USERNAME/PASSWORD)──▶
                information_schema.PROCESSLIST on each registered
                RDS/Aurora/local MySQL instance
```

The app's own metadata database (Postgres, run as the `db` service in
`docker-compose.yml`) is completely separate from the MySQL instances being
monitored. It stores:

- **Users** — username, name, email, bcrypt password hash, role
  (`DEVELOPER`, `DEVOPS`, `ADMIN`), status (`INVITED`/`ACTIVE`/`DISABLED`),
  and (encrypted) MFA state — see "Multi-factor authentication" and
  "Users & invites" below.
- **DB Machines** (`DbConnection`) — host/port/alias for each RDS/Aurora
  (or local test) instance. No monitoring or kill password is stored here
  by default — see "Read-only monitoring credential" and "Kill account"
  below.
- **Audit log** — who did what, when. Never stores a plaintext password.
  Includes both "viewed a kill command" and "confirmed they ran it" events —
  see "Kill Log" below.

There is deliberately no per-application-user credential table. Earlier
versions of this app stored a password for every individual DB user (so the
Kill Query page could authenticate as that same user) — that turned out to
be both operationally painful (a new credential to add every time a new
app-side DB user shows up) and unnecessary: killing another account's
session in MySQL requires the `CONNECTION_ADMIN`/`SUPER` privilege, which
AWS does not let you grant to a regular account on current RDS/Aurora
versions anyway. Instead, this app uses ONE dedicated, narrowly-scoped kill
account (see "Kill account" below) that can terminate any session via AWS's
own `mysql.rds_kill` / `mysql.rds_kill_query` procedures, and nothing else.

Any secret that *is* stored (a per-machine monitor or kill credential
override) is encrypted at rest with AES-256-GCM (`src/lib/crypto.ts`) using
`APP_ENCRYPTION_KEY`.

## Locked / blocked queries

Shown at the top of the dashboard, above "Long-running queries" — this is
usually the more urgent problem, and it's easy to miss otherwise. A "lock
wait" is one session (the **waiting** one) stuck unable to proceed because
another session (the **blocking** one) is holding a lock it needs. The
blocking session is very often **idle** — it ran one statement inside a
transaction, took a row/table lock, and then never committed or rolled
back — so it shows up nowhere in "long-running queries" (nothing about it
looks slow) while everything queued behind its lock silently piles up.
Killing the *blocking* session (not the waiting one) is normally what
actually resolves this — that's why it's the button given the primary
styling in this section, with "kill the waiting session instead" offered
as a small text link for the rare case that's actually what you want.

Detection (`src/lib/mysql-collector.ts`) joins the engine's lock-wait graph
against `information_schema.innodb_trx` to resolve both sides back to a
plain PROCESSLIST id — the same id everything else in this app (Kill Query
included) already works with:

- **MySQL 8.0+ / Aurora MySQL 8** (what RDS runs today): joins
  `performance_schema.data_lock_waits`, per
  [AWS's own recommended troubleshooting query](https://repost.aws/knowledge-center/blocked-mysql-query)
  for exactly this.
- **MariaDB, and MySQL 5.7 and earlier**: falls back automatically to the
  older `information_schema.INNODB_LOCK_WAITS`/`INNODB_LOCKS` tables
  (removed in MySQL 8.0, still present everywhere else) if the query above
  fails with "table doesn't exist" — nothing to configure per machine, it
  just tries the modern one first.

No new grants are needed beyond what `prisma/rds-readonly-user.sql` already
sets up (`PROCESS` + `SELECT` on `performance_schema`) — both engines'
lock-wait tables are covered by those two grants already.

## AWS CloudWatch monitoring

A "Monitoring" nav page shows AWS CloudWatch graphs for each registered
database machine — the same kind of view as the RDS console's own
Monitoring tab, trimmed to the metrics worth checking during an incident
rather than all ~20 the console shows: **CPU Utilization, Database
Connections, Freeable Memory, Free Storage Space, Read/Write Latency,
Read/Write IOPS**, and, for a read replica, **Replica Lag first** (before
everything else — a lagging replica is the one thing on a replica that
doesn't show up any other way in this app).

This is deliberately **CloudWatch's standard `AWS/RDS` metrics only**, not
[Performance Insights](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PerfInsights.html)
("DB Load" and its `DBLoadCPU`/`DBLoadNonCPU`/`DBLoadRelativeToNumVCPUs`
breakdowns, visible in the AWS console screenshots this feature was modeled
on). DB Load is a genuinely different, separate thing: it has to be
enabled per instance, it's billed/retained differently (7-day free
retention, paid tiers beyond that), it's queried through a different AWS
API (`pi:GetResourceMetrics` etc., not `cloudwatch:GetMetricData`), and
it's keyed by a different identifier (`DbiResourceId`, not the DB instance
identifier CloudWatch uses) — enough extra setup that it was left out of
this first pass. It could be added later as its own metric source without
touching anything CloudWatch-related here.

**What you need to do on the AWS side:**

1. **Create a dedicated read-only IAM user** for this app (don't reuse a
   personal or admin IAM user) with a policy like:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics"],
         "Resource": "*"
       }
     ]
   }
   ```
   Then create an access key for that user (IAM console → Users → your user
   → Security credentials → Create access key) and put it in `.env` as
   `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` (the region
   your RDS/Aurora instances actually run in — CloudWatch metrics are
   regional). If this app ever moves onto EC2/ECS/EKS, an attached IAM role
   with the same policy works too — leave the two key/secret variables
   blank and the AWS SDK picks up the role automatically.

   This is a genuinely different kind of credential from the AWS SES SMTP
   username/password used for email — CloudWatch is a plain AWS API, so it
   needs a real AWS access key (or role), not an SES-SMTP-style shortcut.

2. **Add each instance's AWS RDS "DB instance identifier"** — e.g.
   `oms-prod`, `oms-prod-readreplica2` — from the **DB Machines** admin
   page (`awsDbInstanceIdentifier` field, plus an "Is read replica"
   checkbox). This is the identifier exactly as it appears in the RDS
   console's "Configuration" tab, not the hostname used to connect to
   MySQL, and not the alias/name you gave the machine in this app — there's
   no reliable way to derive one from the others, so it's entered once by
   hand per machine, character-for-character. A machine left blank here
   just doesn't show up as monitorable; nothing else about it (query/lock
   monitoring, kill) is affected.

3. **If a machine is in a different AWS region than the rest, set its
   region override too** (same DB Machines page). CloudWatch metrics are
   always scoped to one region per request — `AWS_REGION` in `.env` is the
   default every machine uses, but a per-machine override exists for
   exactly the case of, say, prod + its replicas in one region and a UAT
   instance in another. Leave it blank for any machine that matches the
   default.

**If every metric on a machine comes back "No datapoints" with no error**
(the Monitoring page will call this out directly): CloudWatch doesn't
error on an unrecognized `DBInstanceIdentifier` or a request sent to the
wrong region — it just returns an empty, otherwise-valid result. That
almost always means the identifier or region entered on the DB Machines
page doesn't exactly match the RDS console for that instance. Re-check
both there first before assuming it's a permissions or code problem.

If `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` aren't all
set, or a given machine has no AWS DB instance identifier yet, the
Monitoring page just shows a "not configured" notice in place of that
machine's graphs — same fail-open pattern as the SES email fallback.

Refresh is every 60 seconds (CloudWatch's own standard-metric granularity
is 1 minute, so polling faster than that just burns API calls for no new
data), with a 1h/3h/12h/1d time-range picker. Each refresh is a single
batched `GetMetricData` call per machine (up to ~9 metrics in one request),
not one call per metric, to keep the API cost down.

## Read-only monitoring credential (you create it, not the app)

You create the read-only MySQL user yourself — run
`prisma/rds-readonly-user.sql` against each instance — and hand its
username/password to the app as environment variables:

```
MONITOR_DB_USERNAME=qmon_ro
MONITOR_DB_PASSWORD=<the password you set>
```

That one shared credential is used to poll every registered DB Machine by
default (`src/lib/monitor-credentials.ts`). It's never entered into the
app's UI or stored in the app's database. If one specific instance
genuinely needs a *different* read-only user, you can still give that one
machine its own username/password from the DB Machines admin page — that
per-machine value takes precedence over the environment variables.

## Kill account (you create it, not the app)

Same pattern as the read-only monitoring user, but for killing queries: you
create ONE dedicated MySQL account yourself — run `prisma/rds-kill-user.sql`
against each instance — and hand its credentials to the app as environment
variables:

```
KILL_DB_USERNAME=qmon_killer
KILL_DB_PASSWORD=<the password you set>
```

That account is granted only `PROCESS` (to see sessions) and `EXECUTE` on
AWS's built-in `mysql.rds_kill` / `mysql.rds_kill_query` stored procedures —
nothing else, no table data access. It can terminate *any* session on the
instance regardless of which DB user started it, which is exactly what
lets the Kill Query page work without ever needing a stored credential for
every individual application DB user. See `prisma/rds-kill-user.sql` for
the full rationale and a verification command to run before wiring this in.
Like the monitoring credential, it's never typed into the app's UI — the
app connects with it server-side, on demand, when a DevOps/Admin user
confirms a kill; the credential itself never reaches the browser. A
specific DB Machine can still be given its own kill account override from
the DB Machines admin page if needed.

Because this one account can terminate anything on the instance, and
because the app now runs it on your behalf rather than only ever printing
a command, keep an eye on who's using it — see "Kill Log" below.

## Kill Log

The **Kill Log** page (DevOps/Admin, in the nav bar) is the audit trail for
the whole Kill Query flow — every step is recorded with who, when, which
machine/process, and the query involved:

- **Opened kill page** — logged the moment someone lands on a specific
  query's Kill Query page (i.e., clicked "Kill Query" on the dashboard).
- **Checked status** — logged every time someone clicks "Check current
  status" on that page.
- **✓ Killed** — logged when a kill actually succeeds, after the person
  typed "confirm" in the dialog and it ran.
- **✕ Kill failed** — logged when an attempted kill errors out (bad
  credential, network issue, the RDS procedure rejecting it, etc.), so a
  failed attempt is on the record too, not silently dropped.

Older entries from before the app executed kills itself — "Viewed command"
and "Confirmed killed (legacy)" — stay visible in the log for history, but
nothing generates them anymore.

## Query History (slow-query log)

The live **Dashboard** only ever shows what's running *right now* — the
moment a query finishes, it's gone. **Query History** (in the nav bar, any
logged-in role) is a separate, permanent record of every query that ran 30
minutes or longer, so a query that took an hour last night is still there
to look at this morning.

**It's off by default for every machine**, including ones you registered
before this feature existed — nothing is tracked until you turn it on.
Enable it per machine from **DB Machines** (DevOps/Admin), with the "Query
History" checkbox in that machine's row.

Once on for a machine, a background job built into the app itself checks
that machine every ~2 minutes (`SLOW_QUERY_SCAN_INTERVAL_MS`, default
120000ms) for any query that's been running 30 minutes or more
(`SLOW_QUERY_MIN_DURATION_SECONDS`, default 1800) — no external cron, no
separate worker process, and it keeps running whether or not anyone has
the app open in a browser. It's implemented as a Next.js
`instrumentation.ts` hook (`src/instrumentation.ts` calls
`startSlowQueryScanner()` from `src/lib/slow-query-scanner.ts`), which
requires `experimental.instrumentationHook: true` in `next.config.mjs` on
this project's Next.js version — already set, nothing extra to configure.

**For quick end-to-end testing** (rather than waiting 30 real minutes),
lower both of those in `.env` — e.g. `SLOW_QUERY_SCAN_INTERVAL_MS=30000`
(scan every 30s) and `SLOW_QUERY_MIN_DURATION_SECONDS=300` (5-minute
floor) — then restart the container (no rebuild needed, these are read at
runtime). A query caught this way still shows up labeled "Warning (30–60
min)" — that's the tier label, not literally how long it ran; the real
duration is always shown next to it. Remove both (or set them back to
their defaults) once you're done testing, so production behaves as
documented above.

Every entry shows the actual elapsed time (e.g. "1 hr 24 min"), not just a
severity badge, and falls into one of four severity tiers based on how long
it ran:

| Tier | Duration |
| --- | --- |
| Warning | 30 – 60 minutes |
| Long | 1 – 2 hours |
| Critical | 2 – 3 hours |
| Severe | 3+ hours (open-ended — nothing past 3 hours falls through a gap) |

A query is tracked continuously while it keeps running (its entry's
duration keeps growing, its severity tier updates if it crosses into the
next one) and is marked "Ended" once it's no longer seen — either because
it finished, or because something (including Kill Query) ended it.

The Query History page can be filtered by machine, by database name, by
severity, and by date range — any combination at once — and the same
filters apply to **Export to Excel**, which downloads a real `.xlsx` file
(via `exceljs`, server-side) of exactly what's currently filtered.

Entries older than 30 days are deleted automatically once a day
(`SLOW_QUERY_RETENTION_DAYS`, default 30) — this is a rolling window, not
an archive; export anything you want to keep past that.

## Multi-factor authentication (MFA)

Every account — no exceptions, no per-role opt-out — has to complete TOTP
setup (RFC 6238: Google Authenticator, Microsoft Authenticator, Authy, 1Password,
etc. all work) before it can reach the dashboard. There's no SMS, no push
notification, no third-party service in the loop: the server and the phone
each independently compute the same 6-digit code from a shared secret and
the current time, and nothing crosses the network during a normal login.

**Login flow.** `POST /api/auth/login` checks username + password as
before, but never issues the real session cookie by itself. On success it
issues a short-lived (15 min) "pending" cookie (`src/lib/session.ts`,
`qm_pending` — structurally distinct from the real session cookie, so it
can never be mistaken for one) and tells the client where to go next:

- **`/mfa/verify`** — account already has MFA enabled. Enter the 6-digit
  code (or a backup code). 5 wrong attempts locks the account out of MFA
  verification for 5 minutes (`src/lib/mfa.ts`).
- **`/mfa/setup`** — account doesn't have MFA enabled yet. This covers both
  a brand-new invited user's first login (see "Users & invites" below) and
  any pre-existing account that predates this feature. Scan the QR code,
  type back the current code, done — the real session cookie is issued
  right there, and 10 one-time backup codes are shown once (each one
  single-use, for "I have my password but not my phone").

**Lost your device?** Two ways to recover, both fully audited:

- **Email yourself a reset link** — `/mfa/recovery`, enter your account
  email. If it has MFA enabled, you get an emailed link (30 min expiry,
  single-use) to `/mfa/recovery/[token]`, which lets you redo setup from
  scratch (a brand-new secret, brand-new QR code, brand-new backup codes).
  It does **not** log you in by itself — you still sign in normally
  afterward with your password, which is what proves this wasn't just
  someone who intercepted the email. The response to a recovery request is
  identical whether or not the email matches an account, so this endpoint
  can't be used to check who has an account here.
- **Admin resets it for you** — last resort, if you've also lost access to
  your account email: an Admin can hit **Reset MFA** on the Users page,
  which wipes MFA entirely and forces the normal `/mfa/setup` flow on your
  next login (same as a brand-new account).

None of this touches backup codes as a *login-time* fallback path the way
the emailed link might suggest — backup codes are only ever entered at
`/mfa/verify` (in place of the 6-digit code), and the emailed recovery link
is strictly a "set up a new authenticator app" flow, never a second way to
log in on an ongoing basis.

Every MFA event is audit-logged: `MFA_ENABLED`, `MFA_LOGIN_SUCCESS`,
`MFA_LOGIN_FAILED`, `MFA_RESET_REQUESTED`, `MFA_RESET_VIA_EMAIL`,
`MFA_RESET_BY_ADMIN` (see `src/lib/audit.ts`).

## Users & invites

There's no self-service signup — an Admin creates every account from the
**Users** page (`/admin/users`, Admin-only — narrower than DB Machines,
which DevOps can also manage):

1. Admin fills in username, name, email, and role, and submits. No password
   is set here — an invite email goes out immediately with a link
   (`prisma/schema.prisma` `inviteTokenHash`/`inviteExpiresAt`, 7-day
   expiry, single-use, same hash-not-plaintext pattern as the MFA recovery
   token below).
2. The invitee clicks the link (`/invite/[token]`), sets their own
   password, and is immediately walked into `/mfa/setup` — they can't reach
   the dashboard without finishing it.
3. If a link expires or gets lost, **Resend invite** on the Users page
   issues a fresh one (the old one stops working).
4. **Disable** blocks an account at login regardless of a correct password
   (offboarding) — **Enable** reverses it. An admin can't disable their own
   account, and can't disable the last remaining active Admin account,
   so you can't lock yourself out of user management entirely.

Audit actions: `USER_INVITED`, `USER_INVITE_RESENT`, `USER_INVITE_ACCEPTED`,
`USER_DISABLED`, `USER_ENABLED`.

### Email (AWS SES, via SMTP)

Invite links and MFA recovery links both need the app to send email. It
sends over SMTP using the **SMTP credentials** SES generates for you —
SES console → SMTP Settings → "Create SMTP credentials" — not the AWS
SDK/API. That distinction matters because SES actually offers two
different, incompatible ways to authenticate:

- **API credentials** — a plain IAM access key ID + secret, used to call
  the SES API directly (e.g. the `SendEmailCommand` SDK call). This app
  does **not** use this path.
- **SMTP credentials** — what "Create SMTP credentials" gives you: it
  creates a small IAM user behind the scenes and hands back a username
  (formatted like an access key ID, e.g. `AKIA...`) plus a password that's
  one-way-derived specifically for SMTP AUTH. This is what
  `src/lib/email.ts` (via `nodemailer`) actually uses.

If you generate the wrong one, sending will fail — a real IAM secret access
key does not work as the SMTP password, and vice versa.

Set:

```
SES_SMTP_USERNAME=<the SMTP username SES gave you>
SES_SMTP_PASSWORD=<the SMTP password SES gave you>
SES_REGION=us-east-1          # must match the region you created SMTP credentials in
SES_SMTP_PORT=587             # 587 (STARTTLS) by default; 465 (implicit TLS) as a fallback
SES_FROM_EMAIL=<a verified sender identity/domain in that same region>
APP_BASE_URL=<where this app is reachable>   # used to build the links inside emails
```

If `SES_SMTP_USERNAME`/`SES_SMTP_PASSWORD`/`SES_FROM_EMAIL` aren't all set,
`src/lib/email.ts` logs the email (including the link) to the server
console instead of sending it — handy for developing/testing the invite
and recovery flows before real SES credentials exist, but nobody gets a
real email until all three are set.

Two more things worth knowing if sending doesn't work on the first try:
`SES_FROM_EMAIL` has to be a **verified** identity in SES (a verified
single address, or any address on a verified domain) — SES rejects sends
from an unverified one; and a brand-new SES account starts in the
**sandbox**, which only lets you send to addresses you've also verified —
request production access from the SES console before inviting anyone
whose inbox you haven't manually verified.

## Roles

| Role | Dashboard | Kill Query button | Kill Log | Manage DB machines | Manage users |
|---|---|---|---|---|---|
| `DEVELOPER` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `DEVOPS` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `ADMIN` | ✅ | ✅ | ✅ | ✅ | ✅ |

MFA applies identically to every role — there's no "trusted" role that
skips it.

Route protection is enforced in `src/middleware.ts` (server-side, not just
hidden UI) and re-checked in every API route handler.

## Running it with Docker (recommended)

```bash
cp .env.example .env
# fill in: APP_ENCRYPTION_KEY, SESSION_SECRET (each: openssl rand -base64 32)
#          MONITOR_DB_USERNAME, MONITOR_DB_PASSWORD (the read-only user
#          you created with prisma/rds-readonly-user.sql)
#          APP_BASE_URL, and (for real invite/MFA-recovery emails)
#          SES_SMTP_USERNAME / SES_SMTP_PASSWORD / SES_FROM_EMAIL — see
#          "Email (AWS SES, via SMTP)" above. Leaving those blank still
#          runs, it just logs emails to the console instead of sending.

docker compose up -d --build
```

This starts two containers: `db` (Postgres, the app's own metadata store,
with a named volume so data survives restarts) and `app` (this Next.js
app). The app container runs its own database migrations automatically on
every start (`docker-entrypoint.sh` runs `prisma migrate deploy` before
starting the server) — nothing manual to run.

Open http://localhost:3000 (or whatever `APP_PORT` you set). There are no
users yet, so seed the demo accounts:

```bash
docker compose exec app npx tsx prisma/seed.ts
```

This creates the three demo accounts below and a demo DB Machine pointed
at `127.0.0.1:3306` by default — you'll almost certainly want to add your
own real DB Machine from the admin UI instead (or override
`DEMO_DB_HOST`/`DEMO_DB_PORT` before seeding).

| Username | Email | Password | Role |
|---|---|---|---|
| admin | admin@hotwax.co | ChangeMe!Admin1 | ADMIN |
| devops | devops@hotwax.co | ChangeMe!DevOps1 | DEVOPS |
| dev | dev@hotwax.co | ChangeMe!Dev1 | DEVELOPER |

**Change these passwords** (Prisma Studio, a `psql` update, or extend the
admin UI) before this is anywhere real people rely on it. None of these
seeded accounts has MFA set up yet — the first login for each walks
through `/mfa/setup` before reaching the dashboard, same as any other
account (see "Multi-factor authentication" above). Once you have a real
Admin account of your own with MFA set up, invite real people from the
Users page instead of sharing these.

### Testing against a MySQL instance on your own machine

If you're pointing this at a MySQL/MariaDB running directly on your laptop
(not in Docker) rather than a real RDS instance, there's one wrinkle: the
`app` container can't reach `127.0.0.1`/`localhost` on your machine — that
resolves to the container itself. **When adding the DB Machine** (admin UI
→ DB Machines), set **Host** to `host.docker.internal` instead — the `app`
container is already set up (via `extra_hosts` in `docker-compose.yml`) to
resolve that to your host machine, on Linux as well as Docker Desktop
(Mac/Windows, where it works natively). That's the only host setting that
matters now that the app connects (for both polling and killing) entirely
server-side — there's no longer a separate host a human needs to reach from
their own terminal, since nothing is ever copy-pasted anywhere.

The same applies when seeding: `DEMO_DB_HOST=host.docker.internal
docker compose exec -e DEMO_DB_HOST app npx tsx prisma/seed.ts` (or just
set it via the admin UI after seeding once).

Also make sure your local MySQL is actually listening on all interfaces,
not just `127.0.0.1` — e.g. in `mariadb.conf.d/50-server.cnf`:
`bind-address = 0.0.0.0` — and that the read-only user and the kill account
are created as `'user'@'%'`, not `'user'@'localhost'`, so a connection
arriving from the Docker network is accepted.

### Docker files reference

```
Dockerfile              3-stage build (deps → builder → runner). Ships the
                         full node_modules (incl. the Prisma CLI, needed at
                         container start for `prisma migrate deploy`) rather
                         than Next's standalone output tracing — simpler and
                         more predictable for an internal tool.
docker-entrypoint.sh     Runs on every container start: applies pending
                         Prisma migrations, then starts the server.
docker-compose.yml       app + db (Postgres) services, a named volume for
                         Postgres data, and extra_hosts for reaching a
                         MySQL instance on your own machine.
.dockerignore            Keeps node_modules/.next/.env/etc. out of the
                         build context.
```

## Running it without Docker (plain `npm`)

```bash
npm install
cp .env.example .env
# DATABASE_URL should point at a Postgres instance you run yourself, e.g.
#   postgresql://qmon:qmon_pw@127.0.0.1:5432/query_monitor

npx prisma migrate deploy
npm run seed

# Optional: spin up a local MariaDB with a read-only monitor user and a
# demo app user, so you have something real to point the dashboard at.
bash scripts/setup-local-mysql.sh
npm run collector:test   # fires a SLEEP() query and confirms it's detected

npm run dev
```

## Connecting a real RDS/Aurora MySQL instance

1. Run `prisma/rds-readonly-user.sql` against the instance (as an admin) to
   create the read-only monitoring user. It only gets `PROCESS` and
   `SELECT` on `performance_schema` — no application data, no writes.
2. Run `prisma/rds-kill-user.sql` against the instance to create the
   dedicated kill account. It only gets `PROCESS` and `EXECUTE` on
   `mysql.rds_kill` / `mysql.rds_kill_query` — no application data. Verify
   it can actually kill another account's session before moving on (the
   script includes the command to test this).
3. Set `MONITOR_DB_USERNAME` / `MONITOR_DB_PASSWORD` and `KILL_DB_USERNAME`
   / `KILL_DB_PASSWORD` to those two users' credentials (in `.env` for
   Docker, or your process manager's env for a non-Docker deploy) and
   restart the app.
4. Make sure the app can reach the instance on port 3306 — see "Network
   access to RDS" below.
5. Sign in as a DevOps/Admin account → **DB Machines** → add the instance
   (alias, host, port — leave the monitor/kill username/password fields
   blank to use the shared credentials from step 3).
6. The dashboard will start showing that machine immediately (machine
   selector dropdown, or "All machines"), and Kill Query will work for
   every query on it — there's no per-application-DB-user setup step.

### Network access to RDS

This app needs a route to each RDS/Aurora instance's port (3306 by
default) as the read-only monitoring user. In practice that means running
it inside the same VPC (e.g. on ECS/Fargate, EC2, or an EKS pod) with a
security group rule allowing it to reach the DB security group, the same
way any other backend service would. It does not need to be
internet-facing — put it behind your existing SSO/VPN/internal ALB.

## Production hardening notes

This MVP is built to be genuinely usable, but a few things are worth
tightening before it's the only thing standing between you and a locked
production table:

- **Move `APP_ENCRYPTION_KEY`, `SESSION_SECRET`, `MONITOR_DB_PASSWORD`,
  `KILL_DB_PASSWORD`, and `SES_SMTP_PASSWORD` into a secrets manager**
  (AWS Secrets Manager or SSM Parameter Store `SecureString`) rather than a
  plain `.env` file, and
  restrict who can read them — anyone with `APP_ENCRYPTION_KEY` can decrypt
  any per-machine credential override *and every account's TOTP secret*
  stored in the app's database. Rotate periodically; rotating
  `APP_ENCRYPTION_KEY` requires re-encrypting existing rows (decrypt with
  the old key, re-encrypt with the new one — not implemented here, since
  it's a one-time migration script you'd write against your real
  key-rotation process) — every account's MFA would need re-setup
  (`Reset MFA` from the Users page) if you rotate without doing that
  migration.
- **Audit log retention/alerting.** Every `KILL_EXECUTED` event means a
  session was actually terminated. Consider shipping the audit log to your
  existing log pipeline and alerting on unusual volume, or on any
  `KILL_FAILED` entries (a repeated failure can mean the kill account's
  credential or grants have drifted).
- **Kill credentials never reach the browser.** Unlike the earlier
  "reveal a command" design, the kill account's password is never sent to
  the client in any form — the app connects to the target database
  server-side, after the DevOps/Admin user types "confirm." There's no
  shell-history or `ps` exposure to worry about for kills anymore.
- **Rate-limit the password step.** The MFA step (`/api/auth/mfa-verify`)
  already locks out after 5 wrong codes (`src/lib/mfa.ts`), but
  `POST /api/auth/login` (the password check itself) has no brute-force
  protection yet.
- **SSO.** You picked simple built-in email/password + MFA for this MVP;
  role assignment happens via the Users admin page at invite time (or by
  editing the `User` table directly for an existing account). Swapping in
  your SSO provider later means replacing `src/app/api/auth/login/route.ts`,
  the invite flow, and `src/lib/session.ts` — the RBAC layer
  (`src/lib/rbac.ts`, `src/middleware.ts`) is unaffected, and you'd likely
  drop this app's own MFA in favor of whatever your SSO provider enforces.
- **Postgres image/version pinning, backups, connection pooling (e.g.
  PgBouncer)** — the compose file's `postgres:16-alpine` + named volume is
  fine for one box; a real deployment will want managed Postgres (RDS) and
  your normal backup story instead.

## Project layout

```
Dockerfile / docker-compose.yml / docker-entrypoint.sh / .dockerignore
                              See "Docker files reference" above.

prisma/schema.prisma          App metadata DB schema (users, DB machines, audit log)
prisma/migrations/            Includes the hand-written MFA/user-management migration —
                               see its top comment for why it's not raw `prisma migrate diff` output
prisma/rds-readonly-user.sql  Grants for the read-only monitoring user — run against each RDS instance
prisma/seed.ts                Demo accounts + demo DB machine
scripts/setup-local-mysql.sh  Local MariaDB for development/demo only
scripts/test-collector.ts     Smoke test: fires a slow query, confirms the collector finds & ranks it

src/lib/crypto.ts             AES-256-GCM encrypt/decrypt for stored credentials (incl. TOTP secrets)
src/lib/monitor-credentials.ts  Resolves the read-only credential for a DB Machine (env vars, or per-machine override)
src/lib/kill-credentials.ts   Resolves the dedicated kill account credential for a DB Machine (env vars, or per-machine override)
src/lib/session.ts            Signed session cookie (JWT via jose) + the short-lived pending-MFA cookie
src/lib/rbac.ts               Role → allowed-actions map
src/lib/mysql-collector.ts    Connects with the read-only user: reads PROCESSLIST (sorts by duration)
                               and the lock-wait graph (blocking vs. waiting sessions)
src/lib/audit.ts              Audit log writer
src/lib/totp.ts               TOTP secret generation, QR code, code verification (RFC 6238)
src/lib/backup-codes.ts       One-time MFA backup codes: generate, hash, single-use consume
src/lib/mfa.ts                Shared MFA setup/confirm/verify logic (onboarding + email recovery both use it)
src/lib/tokens.ts             Random token + SHA-256 hash helpers (invite links, MFA recovery links)
src/lib/email.ts              Sends via AWS SES, or logs to console if SES_FROM_EMAIL is unset
src/lib/cloudwatch.ts         AWS CloudWatch client: metric definitions/ordering, batched GetMetricData call
src/middleware.ts             Server-side route protection by role + pending-auth-aware public routes

src/app/login                 Login page (password step)
src/app/mfa/verify            MFA code entry (2nd login step, account already has MFA)
src/app/mfa/setup             First-time MFA setup (forced — new invite or pre-existing account)
src/app/mfa/recovery          "Lost your device?" — request an emailed reset link
src/app/mfa/recovery/[token]  Redo MFA setup from an emailed recovery link (no session/password needed)
src/app/invite/[token]        Accept an invite: set password, then straight into MFA setup
src/app/dashboard              Shared long-running-query dashboard
src/app/dashboard/kill/...    DevOps-only kill-confirmation page
src/app/monitoring            AWS CloudWatch graphs per DB machine (any role, same as Dashboard)
src/app/admin/connections     Manage DB machines (DevOps/Admin)
src/app/admin/kill-log        Kill Log: the full event trail for every kill attempt (DevOps/Admin)
src/app/admin/users           Manage users: invite, disable/enable, resend invite, reset MFA (Admin only)
src/app/api/kill-execute      Actually performs a kill, behind the typed confirmation
src/app/api/users, /api/invite, /api/mfa/*, /api/auth/*   Route handlers backing all of the above
```

## What "Kill Query" does and does not do

This app does execute kills — `src/app/api/kill-execute/route.ts` connects
to the target database itself, using the dedicated kill account, and runs
`mysql.rds_kill`/`mysql.rds_kill_query` (or plain `KILL`, for a
self-managed `DIRECT_KILL` machine). That's a deliberate exception to
keeping the app otherwise read-only: earlier versions only ever printed a
command for a human to run, specifically because doing so would otherwise
have meant storing and exposing a real application DB user's password.
Once the kill account replaced that model — one narrowly-scoped account
that can only ever terminate a session, with no table data access and no
user-management rights — there was no remaining security reason to require
a manual copy/paste step, and a real UX cost to keeping one. So the app
runs it, but only after a DevOps/Admin user explicitly types "confirm" in
a dialog showing exactly what's about to be killed, and every attempt
(succeeded or failed) is written to the Kill Log.

What it still deliberately does NOT do: it never authenticates as the
query's own DB user or a broad admin account (so a compromised session in
this app still can't read or write your data — the kill account simply
can't); it doesn't re-check whether the query is still running before you
open the confirmation dialog (short-lived queries routinely finish before
you finish clicking through — use "Check current status" for that,
immediately before confirming); and the kill account's credentials never
reach the browser in any form — no command, no masked password, nothing to
copy.
