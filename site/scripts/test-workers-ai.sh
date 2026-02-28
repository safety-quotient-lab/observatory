#!/usr/bin/env bash
# Test Workers AI models for HRCB evaluation capability
# Usage: bash scripts/test-workers-ai.sh [model]
# Default model: @cf/meta/llama-3.3-70b-instruct-fp8-fast

set -euo pipefail
cd "$(dirname "$0")/.."

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-<your-account-id>}"  # export CLOUDFLARE_ACCOUNT_ID or set here
MODEL="${1:-@cf/meta/llama-3.3-70b-instruct-fp8-fast}"

# Get API token from wrangler oauth config
API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
if [ -z "$API_TOKEN" ]; then
  API_TOKEN=$(grep 'oauth_token' ~/.config/.wrangler/config/default.toml 2>/dev/null | head -1 | cut -d'"' -f2 || echo "")
fi

if [ -z "$API_TOKEN" ]; then
  echo "Need CLOUDFLARE_API_TOKEN env var or wrangler oauth login."
  exit 1
fi

SYSTEM_PROMPT=$(cat scripts/system-prompt.txt)

# Small test content — a neutral tech blog post
CONTENT="Title: Google Street View in 2026
URL: https://tech.marksblogg.com/google-street-view-2026.html
Domain: tech.marksblogg.com

Content:
I look at Google Street View's global coverage. Google Street View has been expanding coverage across the globe since 2007. The service now covers most major roads in North America, Europe, Australia, and parts of Asia, Africa, and South America. Coverage continues to grow with both Google's own camera cars and user-contributed 360-degree photos. The technology uses a combination of car-mounted cameras, backpack cameras for pedestrian areas, and underwater cameras for ocean exploration. Street View data is used for navigation, real estate, and urban planning applications."

echo "╔══════════════════════════════════════╗"
echo "║     Workers AI HRCB Test            ║"
echo "╚══════════════════════════════════════╝"
echo "  Model: $MODEL"
echo ""

# Build JSON payload
PAYLOAD=$(python3 -c "
import json, sys

system = sys.argv[1]
content = sys.argv[2]

payload = {
    'messages': [
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': content}
    ],
    'max_tokens': 16384,
    'temperature': 0.0
}
print(json.dumps(payload))
" "$SYSTEM_PROMPT" "$CONTENT")

echo "  Sending request..."
START=$(date +%s%N)

RESPONSE=$(curl -s \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>/dev/null)

END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))

echo "  Time: ${ELAPSED}ms"
echo ""

# Check if response is valid
SUCCESS=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success','?'))" 2>/dev/null || echo "parse_error")

if [ "$SUCCESS" != "True" ]; then
  echo "  ERROR: API call failed"
  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
  exit 1
fi

# Extract the response text
RESULT=$(echo "$RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
text = d.get('result', {}).get('response', '')
print(text)
" 2>/dev/null)

# Save full response
OUTFILE="/tmp/workers-ai-test-$(echo $MODEL | tr '/@' '_').json"
echo "$RESULT" > "$OUTFILE"
echo "  Full response saved: $OUTFILE"
echo ""

echo "── Response (first 80 lines) ─────────"
echo "$RESULT" | head -80
echo ""

# Try to parse as JSON and validate HRCB structure
echo "── Validation ────────────────────────"
echo "$RESULT" | python3 -c "
import json, sys, re

text = sys.stdin.read().strip()

# Try to extract JSON from markdown code blocks
m = re.search(r'\`\`\`(?:json)?\s*\n(.*?)\n\`\`\`', text, re.DOTALL)
if m:
    text = m.group(1).strip()

try:
    data = json.loads(text)
except:
    # Try finding JSON object in the text
    start = text.find('{')
    if start >= 0:
        depth = 0
        end = start
        for i, c in enumerate(text[start:], start):
            if c == '{': depth += 1
            elif c == '}': depth -= 1
            if depth == 0:
                end = i + 1
                break
        try:
            data = json.loads(text[start:end])
        except:
            print('  FAIL: Could not parse JSON from response')
            sys.exit(1)
    else:
        print('  FAIL: No JSON object found in response')
        sys.exit(1)

# Check required fields
required = ['content_type', 'scores', 'hrcb_aggregate']
missing = [f for f in required if f not in data]
if missing:
    print(f'  WARN: Missing top-level fields: {missing}')

# Check scores
scores = data.get('scores', {})
if isinstance(scores, dict):
    print(f'  Scores: {len(scores)} sections found')
    # Show a sample
    for key in list(scores.keys())[:3]:
        s = scores[key]
        if isinstance(s, dict):
            e = s.get('e_score', s.get('editorial', '?'))
            st = s.get('s_score', s.get('structural', '?'))
            c = s.get('combined', '?')
            print(f'    {key}: e={e}, s={st}, combined={c}')
elif isinstance(scores, list):
    print(f'  Scores: {len(scores)} sections found (array format)')

# Check aggregate
agg = data.get('hrcb_aggregate', {})
if isinstance(agg, dict):
    final = agg.get('final_score', agg.get('score', '?'))
    conf = agg.get('confidence', '?')
    setl = agg.get('setl', '?')
    print(f'  Aggregate: score={final}, confidence={conf}, setl={setl}')

# Check supplementary signals
signals = data.get('supplementary_signals', {})
if signals:
    print(f'  Supplementary signals: {len(signals)} found')

# Check fair witness
witness = data.get('fair_witness', data.get('witness', {}))
if witness:
    facts = witness.get('witness_facts', witness.get('facts', []))
    inferences = witness.get('witness_inferences', witness.get('inferences', []))
    print(f'  Fair Witness: {len(facts)} facts, {len(inferences)} inferences')

print('')
print('  PASS: Valid HRCB JSON structure')
" 2>/dev/null

echo ""
echo "  Done."
