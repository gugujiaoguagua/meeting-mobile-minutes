#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/meeting-loop-test}"
BACKUP_SCHEDULE="${MEETING_DB_BACKUP_CRON_SCHEDULE:-17 3 * * *}"
CLEANUP_SCHEDULE="${MEETING_SERVER_CLEANUP_CRON_SCHEDULE:-37 4 * * 0}"
BACKUP_LOG="$APP_DIR/.local-data/db-backups/postgres/backup.log"
CLEANUP_LOG="$APP_DIR/.local-data/db-backups/postgres/server-cleanup.log"

if [ ! -f "$APP_DIR/scripts/backup-postgres-to-oss.sh" ]; then
  echo "Missing backup script in $APP_DIR/scripts" >&2
  exit 1
fi

mkdir -p "$(dirname "$BACKUP_LOG")"
chmod +x "$APP_DIR/scripts/backup-postgres-to-oss.sh" "$APP_DIR/scripts/cleanup-server-cache.sh" 2>/dev/null || true

backup_line="$BACKUP_SCHEDULE cd $APP_DIR && APP_DIR=$APP_DIR bash scripts/backup-postgres-to-oss.sh >> $BACKUP_LOG 2>&1 # meeting-loop-postgres-oss-backup"
cleanup_line="$CLEANUP_SCHEDULE cd $APP_DIR && bash scripts/cleanup-server-cache.sh >> $CLEANUP_LOG 2>&1 # meeting-loop-server-cache-cleanup"

{
  crontab -l 2>/dev/null | grep -v 'meeting-loop-postgres-oss-backup' | grep -v 'meeting-loop-server-cache-cleanup' || true
  echo "$backup_line"
  echo "$cleanup_line"
} | crontab -

echo "installedCron=true"
echo "$backup_line"
echo "$cleanup_line"
