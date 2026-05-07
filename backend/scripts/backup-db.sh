#!/usr/bin/env bash
# backend/scripts/backup-db.sh
#
# Online SQLite backup using the .backup command. Safe to run while the app is
# writing — sqlite3 acquires a shared lock and copies pages.
#
# Usage:
#   ./scripts/backup-db.sh [destination-directory]
#
# Defaults destination to ./backups. Backups are timestamped:
#   database-YYYY-MM-DD_HHMMSS.sqlite
#
# Pair this with cron / systemd-timer / a docker sidecar to get periodic backups.
# Retention: keeps the most recent 14 backups by default (override with KEEP=N).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR="${DATA_DIR:-$ROOT_DIR/data}"
DB_FILE="$DATA_DIR/database.sqlite"
DEST_DIR="${1:-$ROOT_DIR/backups}"
KEEP="${KEEP:-14}"

if [[ ! -f "$DB_FILE" ]]; then
  echo "no database file at $DB_FILE" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 CLI is required (apt-get install sqlite3 / brew install sqlite)" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
TS="$(date '+%Y-%m-%d_%H%M%S')"
OUT="$DEST_DIR/database-$TS.sqlite"

echo "Backing up $DB_FILE -> $OUT"
sqlite3 "$DB_FILE" ".backup '$OUT'"
echo "Backup complete: $(du -h "$OUT" | cut -f1)"

# Retain the most recent $KEEP backups.
if [[ "$KEEP" =~ ^[0-9]+$ ]] && (( KEEP > 0 )); then
  ls -1t "$DEST_DIR"/database-*.sqlite 2>/dev/null \
    | tail -n +$((KEEP + 1)) \
    | xargs -r rm -f
fi
