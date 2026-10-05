#!/usr/bin/env sh
set -eu

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /absolute/path/to/rms-backup.sql.gz" >&2
  exit 64
fi

backup_file="$1"
test -f "$backup_file"

gzip -dc "$backup_file" | docker compose --env-file .env exec -T postgres \
  psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" "$POSTGRES_DB"
