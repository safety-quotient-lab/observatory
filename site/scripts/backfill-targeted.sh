#!/usr/bin/env bash
set -euo pipefail

# Targeted backfill: evaluates specific hn_ids using the same pipeline as backfill-eval.sh.
# Usage: ./scripts/backfill-targeted.sh 32173901 29218144 47112309 29296211 46038099

unset CLAUDECODE 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(dirname "$SCRIPT_DIR")"
SYSTEM_PROMPT_FILE="$SCRIPT_DIR/system-prompt.txt"
SQLGEN="$SCRIPT_DIR/eval-to-sql.py"
DELAY="${DELAY:-2}"
PARALLEL="${PARALLEL:-3}"

cd "$SITE_DIR"

if [ $# -eq 0 ]; then
  echo "Usage: $0 <hn_id> [hn_id ...]"
  exit 1
fi

if [ ! -f "$SYSTEM_PROMPT_FILE" ]; then
  echo "ERROR: system-prompt.txt not found at $SYSTEM_PROMPT_FILE"
  exit 1
fi

SYSTEM_PROMPT="$(cat "$SYSTEM_PROMPT_FILE")"

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

run_sql() {
  local sql_file
  sql_file=$(mktemp --suffix=.sql)
  cat > "$sql_file"
  npx wrangler d1 execute hrcb-db --remote --file "$sql_file" 2>/dev/null >/dev/null
  local rc=$?
  rm -f "$sql_file"
  return $rc
}

run_d1_silent() {
  npx wrangler d1 execute hrcb-db --remote --command "$1" 2>/dev/null >/dev/null || true
}

fmt_ms() {
  local ms=$1
  if [ "$ms" -lt 1000 ]; then
    echo "${ms}ms"
  else
    local s=$((ms / 1000))
    local r=$((ms % 1000 / 100))
    echo "${s}.${r}s"
  fi
}

eval_story() {
  local ROW="$1" SLOT="$2" COUNT="$3"

  local HN_ID URL TITLE HN_TEXT DOMAIN
  HN_ID=$(echo "$ROW" | jq -r '.hn_id')
  URL=$(echo "$ROW" | jq -r '.url // empty')
  TITLE=$(echo "$ROW" | jq -r '.title')
  HN_TEXT=$(echo "$ROW" | jq -r '.hn_text // empty')
  DOMAIN=$(echo "$ROW" | jq -r '.domain // empty')

  local LOG="$WORK_DIR/${HN_ID}.log"
  local RESULT="$WORK_DIR/${HN_ID}.result"

  exec > "$LOG" 2>&1

  local STORY_START
  STORY_START=$(date +%s%3N)

  echo "── [$SLOT/$COUNT] hn_id=$HN_ID ──────────────────────────"
  echo "  $TITLE"
  [ -n "$DOMAIN" ] && echo "  domain: $DOMAIN"

  # Mark as evaluating
  run_d1_silent "UPDATE stories SET eval_status = 'evaluating' WHERE hn_id = $HN_ID"

  # Fetch content
  local FETCH_START FETCH_END FETCH_MS CONTENT CONTENT_LEN
  FETCH_START=$(date +%s%3N)
  CONTENT=""

  if [ -n "$URL" ]; then
    CONTENT=$(curl -sL -m 20 -A "HN-HRCB-Bot/1.0" "$URL" \
      | sed 's/<script[^>]*>.*<\/script>//g; s/<style[^>]*>.*<\/style>//g; s/<[^>]*>//g' \
      | tr -s '[:space:]' ' ' \
      | head -c 20000 2>/dev/null || echo "[fetch failed]")
  fi

  FETCH_END=$(date +%s%3N)
  FETCH_MS=$((FETCH_END - FETCH_START))
  CONTENT_LEN=${#CONTENT}
  [ -n "$URL" ] && echo "  fetch: $(fmt_ms $FETCH_MS) (${CONTENT_LEN} chars)"

  # DCP lookup
  local DCP_START DCP_END DCP_MS DCP_BLOCK DCP_STATUS DCP_JSON
  DCP_START=$(date +%s%3N)
  DCP_BLOCK=""
  DCP_STATUS="none"

  if [ -n "$DOMAIN" ]; then
    DCP_JSON=$(npx wrangler d1 execute hrcb-db --remote --json --command \
      "SELECT dcp_json FROM domain_dcp WHERE domain = '$DOMAIN' AND cached_at >= datetime('now', '-7 days')" \
      2>/dev/null | jq -r '.[0].results[0].dcp_json // empty' 2>/dev/null || true)

    if [ -n "$DCP_JSON" ]; then
      DCP_BLOCK="
The Domain Context Profile for this domain has been pre-evaluated. Use this DCP directly (do not re-evaluate domain-level signals). In your output, set \"domain_context_profile\": \"cached\" instead of repeating the full DCP object.

$DCP_JSON
"
      DCP_STATUS="hit"
    else
      DCP_STATUS="miss"
    fi
  fi

  DCP_END=$(date +%s%3N)
  DCP_MS=$((DCP_END - DCP_START))
  echo "  dcp:   $(fmt_ms $DCP_MS) ($DCP_STATUS)"

  # Build prompt + call claude -p
  local TODAY TMPFILE CLAUDE_START CLAUDE_END CLAUDE_MS RESULT_FILE EVAL_JSON EVAL_FILE SCORE_COUNT
  TODAY=$(date -u +%Y-%m-%d)
  TMPFILE=$(mktemp)

  if [ -n "$URL" ]; then
    cat > "$TMPFILE" << USERMSG
Evaluate this URL: $URL
${DCP_BLOCK}
Here is the page content:

$CONTENT

Today's date: $TODAY

Output ONLY the JSON evaluation object, no other text.
USERMSG
  else
    cat > "$TMPFILE" << USERMSG
Evaluate this self-post: $TITLE
${DCP_BLOCK}
Here is the self-post text from Hacker News:
$HN_TEXT

Today's date: $TODAY

Output ONLY the JSON evaluation object, no other text.
USERMSG
  fi

  CLAUDE_START=$(date +%s%3N)
  RESULT_FILE=$(mktemp)
  if ! claude -p \
    --system-prompt "$SYSTEM_PROMPT" \
    --output-format json \
    --model haiku \
    < "$TMPFILE" > "$RESULT_FILE" 2>/dev/null; then
    CLAUDE_END=$(date +%s%3N)
    CLAUDE_MS=$((CLAUDE_END - CLAUDE_START))
    echo "  claude: $(fmt_ms $CLAUDE_MS) FAILED (non-zero exit)"
    run_d1_silent "UPDATE stories SET eval_status = 'failed', eval_error = 'claude-p failed' WHERE hn_id = $HN_ID"
    rm -f "$TMPFILE" "$RESULT_FILE"
    echo "fail	$FETCH_MS	$DCP_MS	$CLAUDE_MS	0	$DCP_STATUS" > "$RESULT"
    return
  fi

  CLAUDE_END=$(date +%s%3N)
  CLAUDE_MS=$((CLAUDE_END - CLAUDE_START))
  rm -f "$TMPFILE"

  EVAL_JSON=$(jq -r '.result // empty' "$RESULT_FILE")
  rm -f "$RESULT_FILE"

  if [ -z "$EVAL_JSON" ]; then
    echo "  claude: $(fmt_ms $CLAUDE_MS) FAILED (no .result)"
    run_d1_silent "UPDATE stories SET eval_status = 'failed', eval_error = 'no result in claude-p output' WHERE hn_id = $HN_ID"
    echo "fail	$FETCH_MS	$DCP_MS	$CLAUDE_MS	0	$DCP_STATUS" > "$RESULT"
    return
  fi

  EVAL_FILE=$(mktemp)
  echo "$EVAL_JSON" > "$EVAL_FILE"

  if ! jq -e '.scores' "$EVAL_FILE" >/dev/null 2>&1; then
    local EXTRACTED
    EXTRACTED=$(sed -n '/^{/,/^}/p' "$EVAL_FILE")
    echo "$EXTRACTED" > "$EVAL_FILE"
    if ! jq -e '.scores' "$EVAL_FILE" >/dev/null 2>&1; then
      echo "  claude: $(fmt_ms $CLAUDE_MS) FAILED (invalid JSON)"
      run_d1_silent "UPDATE stories SET eval_status = 'failed', eval_error = 'invalid eval JSON from claude-p' WHERE hn_id = $HN_ID"
      rm -f "$EVAL_FILE"
      echo "fail	$FETCH_MS	$DCP_MS	$CLAUDE_MS	0	$DCP_STATUS" > "$RESULT"
      return
    fi
  fi

  SCORE_COUNT=$(jq '.scores | length' "$EVAL_FILE")
  if [ "$SCORE_COUNT" -lt 1 ]; then
    echo "  claude: $(fmt_ms $CLAUDE_MS) FAILED (empty scores)"
    run_d1_silent "UPDATE stories SET eval_status = 'failed', eval_error = 'empty scores array' WHERE hn_id = $HN_ID"
    rm -f "$EVAL_FILE"
    echo "fail	$FETCH_MS	$DCP_MS	$CLAUDE_MS	0	$DCP_STATUS" > "$RESULT"
    return
  fi

  echo "  claude: $(fmt_ms $CLAUDE_MS) ($SCORE_COUNT scores)"

  # Write to D1
  local DB_START DB_END DB_MS STORY_END STORY_MS
  DB_START=$(date +%s%3N)

  python3 "$SQLGEN" "$EVAL_FILE" "$HN_ID" scores | run_sql \
    || echo "  WARNING: Failed to write some scores"

  python3 "$SQLGEN" "$EVAL_FILE" "$HN_ID" witness | run_sql \
    || echo "  WARNING: Failed to write some fair_witness data"

  python3 "$SQLGEN" "$EVAL_FILE" "$HN_ID" signals | run_sql || {
    echo "  WARNING: Failed to update stories table with supplementary signals"
    run_d1_silent "UPDATE stories SET eval_status = 'rescoring', eval_error = NULL, evaluated_at = datetime('now') WHERE hn_id = $HN_ID"
  }

  DB_END=$(date +%s%3N)
  DB_MS=$((DB_END - DB_START))

  STORY_END=$(date +%s%3N)
  STORY_MS=$((STORY_END - STORY_START))

  rm -f "$EVAL_FILE"

  echo "  db:    $(fmt_ms $DB_MS)"
  echo "  total: $(fmt_ms $STORY_MS)"

  echo "ok	$FETCH_MS	$DCP_MS	$CLAUDE_MS	$DB_MS	$DCP_STATUS" > "$RESULT"
}

# Build ID list for query
ID_LIST=$(printf '%s,' "$@")
ID_LIST="${ID_LIST%,}"

BATCH_START=$(date +%s)

echo "╔══════════════════════════════════════╗"
echo "║     Targeted HRCB Backfill           ║"
echo "╚══════════════════════════════════════╝"
echo "  IDs: $ID_LIST"
echo "  Delay: ${DELAY}s | Parallel: $PARALLEL"
echo ""

STORIES_FILE=$(mktemp)
npx wrangler d1 execute hrcb-db --remote --json --command "
  SELECT hn_id, url, title, hn_text, domain
  FROM stories
  WHERE hn_id IN ($ID_LIST)
" 2>/dev/null > "$STORIES_FILE"

COUNT=$(jq '.[0].results | length' "$STORIES_FILE")
echo "  Found $COUNT stories"
echo ""

if [ "$COUNT" -eq 0 ]; then
  rm -f "$STORIES_FILE"
  echo "  Nothing to do."
  exit 0
fi

LINES_FILE=$(mktemp)
jq -c '.[0].results[]' "$STORIES_FILE" > "$LINES_FILE"
rm -f "$STORIES_FILE"

HN_IDS=()
while IFS= read -r ROW; do
  HN_IDS+=($(echo "$ROW" | jq -r '.hn_id'))
done < "$LINES_FILE"

CURRENT=0
ACTIVE_PIDS=()

while IFS= read -r ROW; do
  CURRENT=$((CURRENT + 1))

  while [ ${#ACTIVE_PIDS[@]} -ge "$PARALLEL" ]; do
    wait -n "${ACTIVE_PIDS[@]}" 2>/dev/null || true
    STILL_ACTIVE=()
    for pid in "${ACTIVE_PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        STILL_ACTIVE+=("$pid")
      fi
    done
    ACTIVE_PIDS=("${STILL_ACTIVE[@]}")
  done

  eval_story "$ROW" "$CURRENT" "$COUNT" &
  ACTIVE_PIDS+=($!)

  sleep "$DELAY"
done < "$LINES_FILE"

for pid in "${ACTIVE_PIDS[@]}"; do
  wait "$pid" 2>/dev/null || true
done

rm -f "$LINES_FILE"

for hn_id in "${HN_IDS[@]}"; do
  if [ -f "$WORK_DIR/${hn_id}.log" ]; then
    cat "$WORK_DIR/${hn_id}.log"
  fi
done

SUCCESS=0
FAILED=0
TOTAL_FETCH_MS=0
TOTAL_DCP_MS=0
TOTAL_CLAUDE_MS=0
TOTAL_DB_MS=0
DCP_HITS=0
DCP_MISSES=0

for hn_id in "${HN_IDS[@]}"; do
  resfile="$WORK_DIR/${hn_id}.result"
  [ -f "$resfile" ] || continue
  IFS=$'\t' read -r status fetch_ms dcp_ms claude_ms db_ms dcp_status < "$resfile"
  if [ "$status" = "ok" ]; then
    SUCCESS=$((SUCCESS + 1))
  else
    FAILED=$((FAILED + 1))
  fi
  TOTAL_FETCH_MS=$((TOTAL_FETCH_MS + fetch_ms))
  TOTAL_DCP_MS=$((TOTAL_DCP_MS + dcp_ms))
  TOTAL_CLAUDE_MS=$((TOTAL_CLAUDE_MS + claude_ms))
  TOTAL_DB_MS=$((TOTAL_DB_MS + db_ms))
  [ "$dcp_status" = "hit" ] && DCP_HITS=$((DCP_HITS + 1))
  [ "$dcp_status" = "miss" ] && DCP_MISSES=$((DCP_MISSES + 1))
done

BATCH_END=$(date +%s)
BATCH_ELAPSED=$((BATCH_END - BATCH_START))
BATCH_MIN=$((BATCH_ELAPSED / 60))
BATCH_SEC=$((BATCH_ELAPSED % 60))
TOTAL=$((SUCCESS + FAILED))
TOTAL=$((TOTAL > 0 ? TOTAL : 1))
AVG_FETCH=$((TOTAL_FETCH_MS / TOTAL))
AVG_DCP=$((TOTAL_DCP_MS / TOTAL))
AVG_CLAUDE=$((TOTAL_CLAUDE_MS / TOTAL))
AVG_DB=$((TOTAL_DB_MS / (SUCCESS > 0 ? SUCCESS : 1)))

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       Targeted Backfill Complete     ║"
echo "╚══════════════════════════════════════╝"
echo "  Results:  $SUCCESS ok, $FAILED failed ($TOTAL total)"
echo "  Duration: ${BATCH_MIN}m${BATCH_SEC}s (wall clock, ${PARALLEL}x parallel)"
echo ""
echo "  Phase     Avg         Total"
echo "  ──────    ──────      ──────"
echo "  Fetch     $(printf '%-11s' "$(fmt_ms $AVG_FETCH)") $(fmt_ms $TOTAL_FETCH_MS)"
echo "  DCP       $(printf '%-11s' "$(fmt_ms $AVG_DCP)") $(fmt_ms $TOTAL_DCP_MS) ($DCP_HITS hits, $DCP_MISSES misses)"
echo "  Claude    $(printf '%-11s' "$(fmt_ms $AVG_CLAUDE)") $(fmt_ms $TOTAL_CLAUDE_MS)"
echo "  DB write  $(printf '%-11s' "$(fmt_ms $AVG_DB)") $(fmt_ms $TOTAL_DB_MS)"
echo ""
echo "  Rate: ~$(( TOTAL * 60 / (BATCH_ELAPSED > 0 ? BATCH_ELAPSED : 1) )) evals/min"
echo ""
echo "  Next: stories are in 'rescoring' state. Trigger /recalc to finalize aggregates."
