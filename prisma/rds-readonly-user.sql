-- Read-only monitoring user for the Query Monitor app.
-- Run this against each RDS/Aurora MySQL instance you want to register in
-- the app (as the "monitor" user for that DB Machine).
--
-- What this grants:
--   PROCESS                    lets the user see EVERY session's entry in
--                               information_schema.PROCESSLIST (by default
--                               a user only sees its own). This does NOT
--                               allow killing anything, reading table data,
--                               or writing anything.
--   SELECT on performance_schema
--                               optional but recommended if you later want
--                               to extend the collector to read from
--                               performance_schema.events_statements_current
--                               for richer statement text/wait info.
--
-- What this deliberately does NOT grant: SELECT/INSERT/UPDATE/DELETE on any
-- application schema, SUPER, CONNECTION_ADMIN, or KILL. This account cannot
-- read your data and cannot terminate anything.

CREATE USER 'qmon_ro'@'%' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_RANDOM_PASSWORD';

GRANT PROCESS ON *.* TO 'qmon_ro'@'%';
GRANT SELECT ON performance_schema.* TO 'qmon_ro'@'%';

FLUSH PRIVILEGES;

-- Tip: lock this user down at the network layer too — only the security
-- group / network path the app runs from should be able to reach port
-- 3306 as this user (see README "Network access to RDS").
