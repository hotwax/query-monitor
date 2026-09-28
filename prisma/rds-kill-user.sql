-- Dedicated "kill" account for the Query Monitor app.
-- Run this against each RDS/Aurora MySQL instance you want to register in
-- the app (as the KILL_DB_USERNAME / KILL_DB_PASSWORD credential for that
-- DB Machine, or as a per-machine override).
--
-- WHY A SEPARATE ACCOUNT FROM THE READ-ONLY MONITORING USER, AND WHY NOT
-- EACH APPLICATION'S OWN DB USER:
--   In MySQL, killing a session that belongs to a DIFFERENT account requires
--   the CONNECTION_ADMIN privilege (or the older SUPER). AWS does not allow
--   granting CONNECTION_ADMIN/SUPER to a regular account on current-generation
--   RDS/Aurora MySQL — that stays reserved for AWS's own internal management.
--   The RDS-documented way around this is a pair of built-in stored
--   procedures, callable by any account you explicitly grant EXECUTE on:
--     CALL mysql.rds_kill(processID);        -- ends the whole connection
--     CALL mysql.rds_kill_query(processID);  -- ends only the running query
--   So rather than storing every individual application DB user's own real
--   password (which only ever works for killing that exact user's own
--   queries, and still has to be captured/stored somewhere), this app uses
--   ONE narrowly-scoped, purpose-built account that can see and terminate
--   ANY session via those two procedures, and nothing else: no table data
--   access, no ability to create/alter users, no other admin rights.
--
-- What this grants:
--   PROCESS                              see every session (needed to look
--                                         up which processID to pass in).
--   EXECUTE ON PROCEDURE mysql.rds_kill        end a whole connection.
--   EXECUTE ON PROCEDURE mysql.rds_kill_query  end just the running query.
--
-- What this deliberately does NOT grant: SELECT/INSERT/UPDATE/DELETE on any
-- application schema, SUPER, CONNECTION_ADMIN, or the ability to create,
-- alter, or drop users. This account cannot read your data.

CREATE USER 'qmon_killer'@'%' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_RANDOM_PASSWORD';

GRANT PROCESS ON *.* TO 'qmon_killer'@'%';
GRANT EXECUTE ON PROCEDURE mysql.rds_kill TO 'qmon_killer'@'%';
GRANT EXECUTE ON PROCEDURE mysql.rds_kill_query TO 'qmon_killer'@'%';

FLUSH PRIVILEGES;

-- Verify before wiring this into the app: from a second session, find a
-- currently-running query owned by SOME OTHER account, then confirm this
-- account can actually terminate it:
--
--   mysql -h <host> -P 3306 -u qmon_killer -p \
--     -e "CALL mysql.rds_kill(<that other account's processID>);"
--
-- Tip: lock this user down at the network layer too — only the security
-- group / network path the app runs from should be able to reach port
-- 3306 as this user (see README "Network access to RDS"). Its blast radius
-- if leaked is "can terminate any session on this instance" — no data
-- access, but still worth treating like any other privileged credential:
-- rotate it periodically, and keep an eye on the in-app Kill Log (Kill
-- Log admin page) for who's actually using it.
