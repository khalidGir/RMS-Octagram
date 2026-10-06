#!/usr/bin/env sh
set -eu

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

umask 077
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_DIR:-/var/backups/rms}"
backup_file="${backup_dir}/rms-${timestamp}.sql.gz"

mkdir -p "$backup_dir"
docker compose --env-file .env exec -T postgres \
  pg_dump --clean --if-exists --no-owner \
  --username "$POSTGRES_USER" "$POSTGRES_DB" | gzip -9 > "$backup_file"

aws s3 cp "$backup_file" \
  "s3://${S3_BACKUP_BUCKET:-$S3_PROOF_BUCKET}/database/$(basename "$backup_file")" \
  --sse AES256

find "$backup_dir" -type f -name 'rms-*.sql.gz' -mtime +2 -delete
