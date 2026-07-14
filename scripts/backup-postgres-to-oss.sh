#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
LOCAL_BACKUP_DIR="${MEETING_DB_BACKUP_LOCAL_DIR:-.local-data/db-backups/postgres}"
OSS_KEY_PREFIX="${MEETING_DB_BACKUP_OSS_KEY_PREFIX:-backups/postgres}"
LOCAL_RETENTION_DAYS="${MEETING_DB_BACKUP_LOCAL_RETENTION_DAYS:-2}"

cd "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "docker-compose.yml" ]; then
  echo "Missing docker-compose.yml in $APP_DIR" >&2
  exit 1
fi

mkdir -p "$LOCAL_BACKUP_DIR"

timestamp="$(date -u +%Y%m%d-%H%M%S)"
day_path="$(date -u +%Y/%m/%d)"
filename="meeting-loop-postgres-${timestamp}.sql.gz"
tmp_file="$LOCAL_BACKUP_DIR/${filename}.tmp"
backup_file="$LOCAL_BACKUP_DIR/$filename"

cleanup_tmp() {
  rm -f "$tmp_file"
}
trap cleanup_tmp EXIT

echo "postgresBackupStartedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

docker compose --env-file "$ENV_FILE" exec -T db sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' | gzip -9 > "$tmp_file"
mv "$tmp_file" "$backup_file"

bytes="$(wc -c < "$backup_file" | tr -d ' ')"
sha256="$(sha256sum "$backup_file" | awk '{print $1}')"
container_file="/app/${backup_file#./}"
key_suffix="${OSS_KEY_PREFIX}/${day_path}/${filename}"

docker compose --env-file "$ENV_FILE" run --rm app node scripts/upload-postgres-backup-to-oss.mjs \
  --file "$container_file" \
  --key-suffix "$key_suffix" \
  --expected-bytes "$bytes" \
  --sha256 "$sha256"

find "$LOCAL_BACKUP_DIR" -type f -name 'meeting-loop-postgres-*.sql.gz' -mtime +"$LOCAL_RETENTION_DAYS" -delete

echo "postgresBackupLocalFile=$backup_file"
echo "postgresBackupLocalBytes=$bytes"
echo "postgresBackupCompletedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
