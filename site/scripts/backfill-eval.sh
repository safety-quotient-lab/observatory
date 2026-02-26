#!/usr/bin/env bash
set -euo pipefail

# Backfill HRCB evaluations using Claude Code (claude -p) instead of API credits.
# Writes raw per-article scores to D1, marks stories as 'rescoring' for /recalc to finalize.
#
# Usage:
#   ./scripts/backfill-eval.sh [LIMIT]
#   DELAY=10 ./scripts/backfill-eval.sh 20
#
# Environment:
#   DELAY  — seconds between evaluations (default: 8)
#   STATUS — eval_status to query (default: pending)

# Allow running from within a Claude Code session
unset CLAUDECODE 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(dirname "$SCRIPT_DIR")"
SYSTEM_PROMPT_FILE="$SCRIPT_DIR/system-prompt.txt"
LIMIT="${1:-5}"
DELAY="${DELAY:-8}"
STATUS="${STATUS:-pending}"

cd "$SITE_DIR"

if [ ! -f "$SYSTEM_PROMPT_FILE" ]; then
  echo "ERROR: system-prompt.txt not found at $SYSTEM_PROMPT_FILE"
  exit 1
fi

SYSTEM_PROMPT="$(cat "$SYSTEM_PROMPT_FILE")"

# Helper: execute SQL from a temp file (avoids shell quoting issues with --command)
run_sql() {
  local sql_file
  sql_file=$(mktemp --suffix=.sql)
  cat > "$sql_file"
  npx wrangler d1 execute hrcb-db --remote --file "$sql_file" 2>/dev/null
  local rc=$?
  rm -f "$sql_file"
  return $rc
}

echo "=== HRCB Backfill Eval ==="
echo "Limit: $LIMIT | Delay: ${DELAY}s | Status: $STATUS"
echo ""

# 1. Query stories needing evaluation
STORIES_FILE=$(mktemp)
npx wrangler d1 execute hrcb-db --remote --json --command "
  SELECT hn_id, url, title, hn_text, domain
  FROM stories
  WHERE eval_status = '$STATUS'
    AND (url IS NOT NULL OR (hn_text IS NOT NULL AND LENGTH(hn_text) >= 50))
  ORDER BY hn_score DESC NULLS LAST
  LIMIT $LIMIT
" 2>/dev/null > "$STORIES_FILE"

COUNT=$(jq '.[0].results | length' "$STORIES_FILE")
echo "Found $COUNT stories to evaluate"
echo ""

if [ "$COUNT" -eq 0 ]; then
  rm -f "$STORIES_FILE"
  echo "Nothing to do."
  exit 0
fi

# Write each story as a line to a temp file for safe iteration
LINES_FILE=$(mktemp)
jq -c '.[0].results[]' "$STORIES_FILE" > "$LINES_FILE"
rm -f "$STORIES_FILE"

SUCCESS=0
FAILED=0

# Read from file to avoid subshell issues with pipe
while IFS= read -r ROW; do
  HN_ID=$(echo "$ROW" | jq -r '.hn_id')
  URL=$(echo "$ROW" | jq -r '.url // empty')
  TITLE=$(echo "$ROW" | jq -r '.title')
  HN_TEXT=$(echo "$ROW" | jq -r '.hn_text // empty')
  DOMAIN=$(echo "$ROW" | jq -r '.domain // empty')

  echo "--- hn_id=$HN_ID: $TITLE ---"

  # Mark as evaluating to prevent double-eval
  npx wrangler d1 execute hrcb-db --remote --command \
    "UPDATE stories SET eval_status = 'evaluating' WHERE hn_id = $HN_ID AND eval_status = '$STATUS'" \
    2>/dev/null || true

  # Build user message
  TODAY=$(date -u +%Y-%m-%d)
  TMPFILE=$(mktemp)

  if [ -n "$URL" ]; then
    # Fetch and clean content
    CONTENT=$(curl -sL -m 20 -A "HN-HRCB-Bot/1.0" "$URL" \
      | sed 's/<script[^>]*>.*<\/script>//g; s/<style[^>]*>.*<\/style>//g; s/<[^>]*>//g' \
      | tr -s '[:space:]' ' ' \
      | head -c 20000 2>/dev/null || echo "[fetch failed]")

    cat > "$TMPFILE" << USERMSG
Evaluate this URL: $URL

Here is the page content (truncated):

$CONTENT

Today's date: $TODAY

Output ONLY the JSON evaluation object, no other text.
USERMSG
  else
    cat > "$TMPFILE" << USERMSG
Evaluate this self-post: $TITLE

Here is the self-post text from Hacker News:
$HN_TEXT

Today's date: $TODAY

Output ONLY the JSON evaluation object, no other text.
USERMSG
  fi

  # Run claude -p with system prompt
  echo "  Running claude -p..."
  RESULT_FILE=$(mktemp)
  if ! claude -p \
    --system-prompt "$SYSTEM_PROMPT" \
    --output-format json \
    --model haiku \
    < "$TMPFILE" > "$RESULT_FILE" 2>/dev/null; then
    echo "  FAILED: claude -p returned non-zero"
    npx wrangler d1 execute hrcb-db --remote --command \
      "UPDATE stories SET eval_status = 'failed', eval_error = 'claude-p failed' WHERE hn_id = $HN_ID" \
      2>/dev/null || true
    rm -f "$TMPFILE" "$RESULT_FILE"
    FAILED=$((FAILED + 1))
    sleep "$DELAY"
    continue
  fi

  rm -f "$TMPFILE"

  # Extract eval JSON from claude's response
  EVAL_JSON=$(jq -r '.result // empty' "$RESULT_FILE")
  rm -f "$RESULT_FILE"

  if [ -z "$EVAL_JSON" ]; then
    echo "  FAILED: No .result in claude output"
    npx wrangler d1 execute hrcb-db --remote --command \
      "UPDATE stories SET eval_status = 'failed', eval_error = 'no result in claude-p output' WHERE hn_id = $HN_ID" \
      2>/dev/null || true
    FAILED=$((FAILED + 1))
    sleep "$DELAY"
    continue
  fi

  # The result is a text string — try to parse as JSON
  EVAL_FILE=$(mktemp)
  echo "$EVAL_JSON" > "$EVAL_FILE"

  if ! jq -e '.scores' "$EVAL_FILE" >/dev/null 2>&1; then
    # Try extracting JSON object from the text (might have markdown fences)
    EXTRACTED=$(sed -n '/^{/,/^}/p' "$EVAL_FILE")
    echo "$EXTRACTED" > "$EVAL_FILE"
    if ! jq -e '.scores' "$EVAL_FILE" >/dev/null 2>&1; then
      echo "  FAILED: Could not parse eval JSON from claude output"
      npx wrangler d1 execute hrcb-db --remote --command \
        "UPDATE stories SET eval_status = 'failed', eval_error = 'invalid eval JSON from claude-p' WHERE hn_id = $HN_ID" \
        2>/dev/null || true
      rm -f "$EVAL_FILE"
      FAILED=$((FAILED + 1))
      sleep "$DELAY"
      continue
    fi
  fi

  # Validate scores array exists and has entries
  SCORE_COUNT=$(jq '.scores | length' "$EVAL_FILE")
  if [ "$SCORE_COUNT" -lt 1 ]; then
    echo "  FAILED: scores array is empty"
    npx wrangler d1 execute hrcb-db --remote --command \
      "UPDATE stories SET eval_status = 'failed', eval_error = 'empty scores array' WHERE hn_id = $HN_ID" \
      2>/dev/null || true
    rm -f "$EVAL_FILE"
    FAILED=$((FAILED + 1))
    sleep "$DELAY"
    continue
  fi

  echo "  Got $SCORE_COUNT scores, writing to D1..."

  # Use Python helper to generate properly-escaped SQL (avoids all shell/jq quoting issues)
  SQLGEN="$SCRIPT_DIR/eval-to-sql.py"

  # Write scores
  python3 "$SQLGEN" "$EVAL_FILE" "$HN_ID" scores | run_sql \
    || echo "  WARNING: Failed to write some scores"

  # Write fair_witness data
  python3 "$SQLGEN" "$EVAL_FILE" "$HN_ID" witness | run_sql \
    || echo "  WARNING: Failed to write some fair_witness data"

  # Write supplementary signals + mark as rescoring
  python3 "$SQLGEN" "$EVAL_FILE" "$HN_ID" signals | run_sql || {
    echo "  WARNING: Failed to update stories table with supplementary signals"
    # Fallback: at least mark as rescoring
    npx wrangler d1 execute hrcb-db --remote --command \
      "UPDATE stories SET eval_status = 'rescoring', eval_error = NULL, evaluated_at = datetime('now') WHERE hn_id = $HN_ID" \
      2>/dev/null || true
  }

  rm -f "$EVAL_FILE"
  SUCCESS=$((SUCCESS + 1))
  echo "  OK: $SCORE_COUNT scores written, marked for rescoring"
  sleep "$DELAY"
done < "$LINES_FILE"

rm -f "$LINES_FILE"

echo ""
echo "=== Backfill complete: $SUCCESS succeeded, $FAILED failed ==="
