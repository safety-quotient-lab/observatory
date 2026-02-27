#!/usr/bin/env bash
# backfill-daemon.sh — runs the HRCB standalone evaluator in a loop.
#
# Usage (self-starts in a screen session if not already inside one):
#   bash backfill-daemon.sh [light|full] [batch_size] [concurrency]
#
# Monitor:
#   tail -f ~/projects/unudhr/backfill.log
#   screen -r backfill
#
# Stop gracefully (finishes current batch first):
#   touch ~/projects/unudhr/.backfill-stop

set -euo pipefail

MODE="${1:-light}"
BATCH="${2:-1}"
CONCURRENCY="${3:-3}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Self-start inside a detached tmux session if we're not already in one
if [ -z "${TMUX:-}" ]; then
  echo "Launching backfill daemon in detached tmux session 'backfill'..."
  tmux new-session -d -s backfill bash "$SCRIPT_DIR/backfill-daemon.sh" "$MODE" "$BATCH" "$CONCURRENCY"
  echo "Started. Attach with: tmux attach -t backfill"
  echo "Monitor with:         tail -f $(dirname "$SCRIPT_DIR")/backfill.log"
  exit 0
fi
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$PROJECT_DIR/backfill.log"
STOP_FILE="$PROJECT_DIR/.backfill-stop"
SLEEP_BETWEEN_BATCHES=15   # seconds between batches
SLEEP_EMPTY_QUEUE=300      # seconds to wait when queue is empty (5 min)

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

log "========================================"
log "Backfill daemon starting"
log "Mode: $MODE | Batch: $BATCH | Concurrency: $CONCURRENCY | Script: $SCRIPT_DIR"
log "Log: $LOG_FILE"
log "Stop with: touch $STOP_FILE"
log "========================================"

consecutive_errors=0

while true; do
  # Check stop sentinel
  if [ -f "$STOP_FILE" ]; then
    log "Stop file found — shutting down cleanly."
    rm -f "$STOP_FILE"
    break
  fi

  log "--- Batch start (mode=$MODE, limit=$BATCH) ---"

  # Run evaluator, capture output, don't exit on error
  set +e
  output=$(node "$SCRIPT_DIR/evaluate-standalone.mjs" --mode "$MODE" --limit "$BATCH" --concurrency "$CONCURRENCY" 2>&1)
  exit_code=$?
  set -e

  # Log output
  echo "$output" | while IFS= read -r line; do
    echo "[$(date '+%H:%M:%S')] $line" | tee -a "$LOG_FILE"
  done

  if [ $exit_code -ne 0 ]; then
    consecutive_errors=$((consecutive_errors + 1))
    log "Batch failed (exit $exit_code). Consecutive errors: $consecutive_errors"
    if [ $consecutive_errors -ge 5 ]; then
      log "5 consecutive errors — stopping daemon to prevent hammering."
      break
    fi
    log "Sleeping 60s before retry..."
    sleep 60
    continue
  fi

  consecutive_errors=0

  # Check if queue was empty
  if echo "$output" | grep -q "Queue is empty"; then
    log "Queue is empty — sleeping ${SLEEP_EMPTY_QUEUE}s before checking again..."
    sleep "$SLEEP_EMPTY_QUEUE"
  else
    log "Batch complete — sleeping ${SLEEP_BETWEEN_BATCHES}s..."
    sleep "$SLEEP_BETWEEN_BATCHES"
  fi
done

log "Backfill daemon stopped."
