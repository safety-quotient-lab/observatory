# Kagi API — Capability Map for HRO

**Key:** `KAGI_API_KEY` in `site/.dev.vars`
**Plan:** Ultimate ($25/mo) — unlimited searches, no rate limits.
**Auth header:** `Authorization: Bot <KAGI_API_KEY>`
**Base URL:** `https://kagi.com/api/v0`

## Endpoints

### 1. FastGPT — AI-Powered Search (HIGH value)

AI-synthesized answer to a question, with source citations. Think "search that reads
the results and gives you a summary."

```bash
curl -s https://kagi.com/api/v0/fastgpt \
  -H "Authorization: Bot $KAGI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"What is the current state of UDHR ratification?"}'
```

**Response shape:**
```json
{
  "meta": { "id": "...", "node": "...", "ms": 1285 },
  "data": {
    "output": "The UDHR was adopted in 1948...",
    "tokens": 652,
    "references": [
      { "title": "...", "snippet": "...", "url": "https://..." }
    ]
  }
}
```

**Key fields:** `data.output` (the answer), `data.references` (source URLs with titles/snippets).

**Options:**
- `cache`: boolean — use Kagi's cache (default true)
- `web_search`: boolean — enable web search (default true)

### 2. Universal Summarizer (HIGH value)

Summarize any URL, document, or raw text. Supports web pages, PDFs, YouTube transcripts,
podcasts, and more.

```bash
# Summarize a URL
curl -s "https://kagi.com/api/v0/summarize?url=https://example.com/article" \
  -H "Authorization: Bot $KAGI_API_KEY"

# Summarize raw text (POST)
curl -s https://kagi.com/api/v0/summarize \
  -H "Authorization: Bot $KAGI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Long article text here..."}'
```

**Response shape:**
```json
{
  "data": { "output": "Summary text...", "tokens": 340 }
}
```

**Options:**
- `engine`: `cecil` (default, balanced), `agnes` (creative), `daphne` (formal), `muriel` (best quality)
- `summary_type`: `summary` (default), `takeaway` (key points), `tl;dr`
- `target_language`: ISO 639 code for translated summaries

### 3. Web Search — Raw Results (MEDIUM value)

Raw search results (titles, URLs, snippets) without AI synthesis. Use when you need
the links themselves, not a summarized answer.

```bash
curl -s "https://kagi.com/api/v0/search?q=UDHR+Article+19+press+freedom" \
  -H "Authorization: Bot $KAGI_API_KEY"
```

**Response shape:**
```json
{
  "data": [
    { "t": 0, "rank": 1, "url": "https://...", "title": "...", "snippet": "..." },
    { "t": 0, "rank": 2, "url": "https://...", "title": "...", "snippet": "..." }
  ]
}
```

**Note:** `t` field indicates result type: 0 = organic, 1 = news/images.

**Status:** Beta access required — email support@kagi.com to request. Auth works,
but returns "Unauthorized: Search API is currently in beta."

### 4. Enrichment — Domain/Topic Intelligence (LOW-MEDIUM value)

Structured data about a URL, domain, or topic. Two sub-endpoints: web and news.

```bash
# Web enrichment (domain/company data)
curl -s "https://kagi.com/api/v0/enrich/web?q=example.com" \
  -H "Authorization: Bot $KAGI_API_KEY"

# News enrichment (recent news about a topic)
curl -s "https://kagi.com/api/v0/enrich/news?q=artificial+intelligence+regulation" \
  -H "Authorization: Bot $KAGI_API_KEY"
```

**Response shape:**
```json
{
  "data": [
    { "t": "Article Title", "url": "https://...", "snippet": "...", "published": "2026-03-01T..." }
  ]
}
```

## What Kagi Can Do (relevant to HRO)

### 1. Content Research & Fact-Checking (HIGH value)

FastGPT excels at answering factual questions with citations — directly useful for:
- **External validation:** "What do press freedom organizations say about [domain]?"
- **Article context:** "What is the background on [topic from HN story]?"
- **UDHR provision research:** "Which countries have constitutional protections for Article 19?"
- **Methodology peer review:** "What are common criticisms of sentiment analysis for human rights measurement?"

### 2. Article Summarization (HIGH value)

The Summarizer can process URLs that our pipeline evaluates:
- **Content understanding:** Summarize an article before evaluation to verify our scoring makes sense
- **Calibration aid:** Generate summaries of calibration URLs for manual review
- **Blog research:** Summarize source material for observatory blog posts
- **Takeaway extraction:** `summary_type: "takeaway"` returns key points — useful for
  comparing our HRCB signals against what the article actually communicates

### 3. Source Discovery (MEDIUM value — pending beta)

Raw web search would enable:
- **Domain research:** Find background on domains in our corpus
- **Reference finding:** Locate academic papers or reports relevant to our methodology
- **Competitor analysis:** Find other UDHR-related tech projects or human rights tech tools
- **News context:** Find recent news about domains/companies we're scoring

### 4. News Monitoring (LOW-MEDIUM value)

News enrichment could feed:
- **Domain context:** Recent news about domains we're evaluating (reputation signal)
- **Rights event tracking:** Monitor specific human rights topics for correlation with HN coverage
- **Methodology evolution:** Track academic publications about content analysis methods

## What Kagi CANNOT Do

- **No structured data extraction** — returns text, not parsed entities or tables
- **No batch processing** — one query at a time (no bulk search API)
- **No custom ranking** — can't tune search results for our specific domain
- **No real-time monitoring** — pull-based, not push (no webhooks)
- **No computational math** — use Wolfram Alpha for statistical validation

## Recommended Use Cases (Priority Order)

### Tier 1 — Fact-Checking & Research Oracle (no budget limit)
Use FastGPT as a research assistant for validation and blog writing:
- Verify claims about press freedom, internet access, or legal frameworks
- Research background context for high-SETL stories (structural-editorial tension)
- Cross-reference our findings against external sources
- Answer methodology questions with cited sources

### Tier 2 — Article Summarization Pipeline (no budget limit)
Use Summarizer for content understanding:
- Summarize articles that produce unexpected HRCB scores (debugging tool)
- Generate takeaways for calibration set comparison
- Summarize external evaluation reports (Gemini, etc.) for documentation

### Tier 3 — Source Discovery (pending beta)
When Web Search API graduates from beta:
- Build domain reputation context from web sources
- Find academic references for methodology documentation
- Discover related projects for the about/methodology pages

## Integration Pattern

```js
// FastGPT — AI search with citations
const res = await fetch('https://kagi.com/api/v0/fastgpt', {
  method: 'POST',
  headers: {
    'Authorization': `Bot ${KAGI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query }),
});
const { data } = await res.json();
// data.output = answer, data.references = [{ title, url, snippet }]

// Summarizer — summarize any URL
const res = await fetch(
  `https://kagi.com/api/v0/summarize?url=${encodeURIComponent(url)}`,
  { headers: { 'Authorization': `Bot ${KAGI_API_KEY}` } }
);
const { data } = await res.json();
// data.output = summary text

// Enrichment — domain/topic intel
const res = await fetch(
  `https://kagi.com/api/v0/enrich/news?q=${encodeURIComponent(topic)}`,
  { headers: { 'Authorization': `Bot ${KAGI_API_KEY}` } }
);
const { data } = await res.json();
// data = [{ t, url, snippet, published }]
```

## Budget & Rate Limits

With Ultimate plan ($25/mo), searches draw from an unlimited pool.
No per-minute rate limits published. Kagi's acceptable use policy
asks that usage stay within "reasonable personal use" — automated
bulk loops (thousands of queries/hour) would violate terms, but
normal agent-driven research queries have no practical cap.

| Use case | Est. calls/month | Notes |
|----------|-----------------|-------|
| FastGPT research | 50-200 | Burst during blog/validation work |
| Summarizer | 20-100 | Article debugging, calibration |
| Enrichment | 10-50 | Domain context, news monitoring |
| Web Search | 50-200 | When beta access granted |
| Total | ~130-550 | Well within unlimited plan |

## Comparison with Existing APIs

| Need | Kagi | Wolfram Alpha | Gemini/OpenRouter |
|------|------|---------------|-------------------|
| Factual questions | FastGPT (cited) | N/A | Can answer but hallucinates |
| Math/statistics | N/A | Wolfram (ground truth) | Approximate only |
| URL summarization | Summarizer | N/A | Can do but expensive |
| Structured feedback | N/A | N/A | Gemini/OpenRouter (eval format) |
| Web search | Search (beta) | N/A | N/A |
| Domain intel | Enrichment | Limited | N/A |

**Key insight:** Kagi complements Wolfram Alpha — Kagi handles text/search/summarization,
Wolfram handles math/computation. Together with Gemini/OpenRouter for structured LLM
feedback, the observatory has three orthogonal external intelligence sources.

## Next Steps

1. Add `KAGI_API_KEY` to `site/.dev.vars`
2. Add as provider to `scripts/external-feedback.mjs` (FastGPT for research queries)
3. Build a `--provider kagi` mode for external-feedback.mjs
4. Consider Summarizer integration for article debugging workflow
5. Request Web Search beta access (email support@kagi.com)
