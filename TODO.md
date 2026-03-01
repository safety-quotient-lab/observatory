# TODO

Items are organized by execution horizon. Phases 2 and 3 are sequenced
prerequisites for commercialization and GitHub publishing respectively.

Completed rounds (1–4.7, 5.5, 8) archived in git history.

---

## Phase 1 — Active Engineering
*Ordered by dependency and value.*

### Round 4.9 — Model Hygiene

- [ ] **Disable or remediate deepseek-v3.2** *(investigation complete, decision pending)*
  - 25% of "done" evals have at least one channel missing (14.7% no editorial, 9.2% no structural)
  - Avg confidence 0.141 vs haiku 0.208 — 32% lower across 317 shared stories
  - Score divergence vs haiku: delta >0.5 on ~6 stories, worst case 1.191 — far above 0.25 contested threshold
  - JSON verbosity causes truncation at ~17,750 chars (hits 15s AbortController); generates ~4× more output than needed
  - 19 timeout failures; no formal calibration run (has evaluated lite cal IDs -2001..-2015 by mistake, not full cal set)
  - **To disable:** `wrangler d1 execute hrcb-db --remote --command "UPDATE model_registry SET enabled=0, disabled_reason='...' WHERE model_id='deepseek-v3.2'"` + set `enabled: false` in `models.ts`
  - **Alternative to disabling:** increase `max_tokens` cap, add a response-length hint to the prompt, run calibration against -1001..-1015, then re-evaluate
  - 1838 queued eval_queue entries will need cleanup if disabled

### Round 4.8 — Consensus Quality

- [ ] **Confidence-weighted consensus** *(knock-on analysis complete, ready to implement)*
  - Replace flat `baseWeight = 1.0 | 0.5` in `updateConsensusScore()` with evidence-weighted `hcb_confidence`
  - Change in `eval-write.ts:280` — add `re.hcb_confidence` to SELECT, use as weight base
  - Keep `prompt_mode` as separate multiplier: `weight = confidence * liteDiscount * truncDiscount`
  - Clamp confidence floor at 0.2 (no model fully silenced)
  - Fallback: `COALESCE(re.hcb_confidence, 0.5)` for NULL rows
  - **Pre-flight:** query `SELECT AVG(hcb_confidence) FROM rater_evals WHERE prompt_mode='lite'` to verify lite distribution
  - **Post-deploy:** re-run `POST /calibrate/check` to verify cal scores still in range
  - **Risk:** lite models systematically deweighted (~30-50% influence loss); cal scores may shift
  - ~15 lines of code, single function, M effort

### Round 5 — Data Expansion

- [ ] **Enhanced comments**
  - Deep comment crawling (recursive depth 2+ for high-engagement stories)
  - Comment refresh for active discussions; comment score tracking over time
  - Lightweight sentiment on top comments (lite prompt mode)
  - Per-comment HRCB lean score — compare aggregate comment lean vs story HRCB
  - Flag stories where comments strongly disagree with assessment
  - UI: divergence badge on item page, comment sentiment distribution chart

### Round 6 — User-Facing Features

- [ ] **Domain factions enhancements**
  - Faction drift tracking over time
  - Force-directed faction network visualization

- [ ] **Seldon dashboard enhancements**
  - Per-article daily trends
  - Confidence interval bands
  - Real-world event annotation layer

- [ ] **Rights network enhancements**
  - Cluster detection (community finding algorithm)
  - Temporal network evolution (how correlations shift)

### Round 7 — Platform

- [ ] **Bulk re-evaluation endpoint**
  - Re-enqueue by domain, date range, model, methodology_hash
  - Rate-limited to prevent queue flooding

---

## Phase 2 — Commercialization Gate
*Mostly unblocked. Build before publishing. Stripe + dataset license wait on Phase 3.*

- [ ] **API key system** — the commercial gate
  - D1 table: `api_keys` (key_hash, tier, quota_per_hour, owner, created_at, active)
  - Key issuance endpoint (email-based or OAuth)
  - Replace IP-based KV rate limit on `/api/v1/` with key-based quota tracking
  - A `/api-keys` management UI page

- [ ] **Stripe integration** *(needs license + publishing strategy first)*
  - Webhook handler updates `api_keys.tier` in D1
  - Tiers: free (IP-rate-limited) → research → pro → enterprise (manual)
  - `/pricing` page

- [ ] **Bulk export implementation**
  - CSV/JSONL to R2 daily snapshot (R2 bound to cron worker)
  - Implement the 501 stubs: `/api/v1/export/stories.csv`, `.jsonl`,
    `domains.csv`, `rater-evals.jsonl`

- [ ] **Full-text search endpoint**
  - `/api/v1/search` via FTS5 virtual table on D1

- [ ] **Dataset license decision** *(CC BY-NC-SA 4.0 recommended; publish to `/data` once decided)*

---

## Phase 3 — Open Source Prep
*Blocked on license decision. Do before creating the public GitHub repo.*

- [ ] **Decide on `LICENSE`** — TBD (AGPL-3.0 was considered; not yet decided)

- [ ] **Write `README.md`** — architecture overview, what it does, screenshots, local dev setup

- [ ] **`IDEAS.md` publish decision** — keeping for now; revisit when license is decided

- [ ] **Revoke/rotate live credentials** — do immediately before `git push` to public repo
  - `ANTHROPIC_API_KEY` — revoke at console.anthropic.com → API Keys, re-issue, `wrangler secret put`
  - `OPENROUTER_API_KEY` — revoke at openrouter.ai → Keys, re-issue, `wrangler secret put`
  - `TRIGGER_SECRET` — rotate: `openssl rand -base64 32`, update `site/.dev.vars`, `wrangler secret put`
  - **Status:** never committed (`git log` verified); `.gitignore` covers `*.key` + `.dev.vars`
