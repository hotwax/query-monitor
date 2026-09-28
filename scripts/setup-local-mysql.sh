#!/usr/bin/env bash
# Spins up a local MariaDB instance purely so `npm run collector:test` and
# the seeded "local-demo-mysql" connection have something real to talk to.
# Not needed in production — there you point a DB Machine at your actual
# RDS/Aurora endpoint instead.
set -euo pipefail

if ! command -v mariadbd >/dev/null 2>&1 && ! command -v mysqld >/dev/null 2>&1; then
  echo "Installing mariadb-server..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq mariadb-server
fi

sudo service mariadb start || sudo service mysql start

mysql -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS demo_shop;

CREATE USER IF NOT EXISTS 'qmon_ro'@'%' IDENTIFIED BY 'qmon_ro_pw';
GRANT PROCESS ON *.* TO 'qmon_ro'@'%';
GRANT SELECT ON performance_schema.* TO 'qmon_ro'@'%';

CREATE USER IF NOT EXISTS 'order_svc'@'%' IDENTIFIED BY 'order_svc_pw';
GRANT ALL PRIVILEGES ON demo_shop.* TO 'order_svc'@'%';

FLUSH PRIVILEGES;
SQL

echo "Local MariaDB ready: qmon_ro (read-only monitor) + order_svc (demo app user) on demo_shop."
