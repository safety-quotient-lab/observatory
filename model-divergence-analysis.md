# Model Divergence Analysis: Claude vs Llama

Date: 2026-03-02
Status: ACTIVE — informs consensus weighting, calibration, and coverage strategy

---

## The Observation

| Model | Prompt Mode | Evals | Avg Editorial | Avg Structural | Avg Weighted |
|-------|-------------|-------|---------------|---------------|--------------|
| Claude Haiku 4.5 | full | 755 | +0.250 | present | +0.217 |
| Llama 4 Scout (WAI) | lite | 3,273 | +0.097 | +0.053* | +0.097 |
| Llama 3.3 70B (WAI) | lite | 3,274 | +0.089 | null | +0.089 |
| DeepSeek v3.2 | full (disabled) | 815 | +0.191 | +0.080 | +0.162 |

*Llama 4 Scout occasionally returns structural scores despite lite prompt — anomalous.

Claude scores **2.4× higher** than Llama models on average editorial score.

---

## Root Cause: Prompt Mode Asymmetry

This is NOT primarily a model capability difference. It's a **measurement architecture difference**:

### Full mode (Claude, DeepSeek)
- 31 per-section scores (Preamble + Articles 1-30)
- Each section: editorial score + structural score + evidence + directionality + note
- Domain Context Profile (DCP) modifiers applied
- Content-type-specific channel weights
- Schema: v3.7 (complex structured JSON output)

### Lite mode (Llama models)
- Single holistic integer 0-100 (converted to [-1,+1] via `(score-50)/50`)
- Editorial only — no structural channel
- No per-section breakdown
- No DCP, no evidence tiers, no directionality
- Schema: lite-1.4 (simple JSON with `reasoning` field)

### Why full mode scores higher

1. **Granularity effect**: Full mode evaluates 31 provisions independently. Even
   tangentially related content gets a small positive score for relevant
   provisions. The weighted mean aggregates many small positives into a
   moderate positive. Lite mode's single holistic impression doesn't capture
   these marginal engagements.

2. **Structural channel contribution**: Full mode adds structural scores
   (site-level policies). Most mainstream sites have some positive structural
   signal (privacy policy exists, HTTPS, accessibility). This lifts the
   weighted mean. Lite mode has no structural channel.

3. **DCP boost**: Domain Context Profile adds inherited modifiers from
   domain-level policies. This generally shifts scores positive (most domains
   have basic rights infrastructure). Lite mode skips DCP entirely.

4. **Anchoring/halo effect**: When evaluating 31 sections sequentially, early
   positive scores may anchor subsequent sections upward (LLM halo effect).
   Lite mode's single assessment isn't subject to this within-eval contamination.

---

## Consequences

### Coverage-dependent score bias (CRITICAL)

Stories evaluated by Claude (full) get higher scores than stories evaluated
only by Llama (lite). Claude evaluates top-priority stories (higher HN score,
more API credits). Llama evaluates everything (free tier, bulk coverage).

This creates a **confound**: high-HN-score stories appear more rights-positive,
but this may be partially an artifact of which model evaluated them, not a
genuine content property.

### Consensus weighting already partially addresses this

`updateConsensusScore()` uses:
- `baseWeight`: full=1.0, lite=0.5
- `confidenceFactor`: max(0.2, COALESCE(hcb_confidence, 0.5))
- `truncDiscount`: 1 - truncPct × 0.5

Lite evals contribute half the weight of full evals in consensus. But for
stories with ONLY lite evals (no Claude eval), the consensus IS the lite
score — no correction possible.

### Confidence incomparability

Lite avg confidence: ~0.85 (maps from 0-100 integer — models tend toward high).
Full avg confidence: ~0.17 (granular LLM self-report, much more conservative).
These are on different scales — confidence only differentiates WITHIN a mode.

---

## Diagnosis Protocol

### How to detect if the divergence is worsening

```sql
-- Monthly trend: avg score by prompt mode
SELECT DATE(evaluated_at, 'start of month') as month, prompt_mode,
  COUNT(*) as n, ROUND(AVG(hcb_weighted_mean),3) as avg,
  ROUND(AVG(hcb_editorial_mean),3) as avg_e
FROM rater_evals WHERE hn_id > 0
GROUP BY month, prompt_mode ORDER BY month, prompt_mode;

-- Stories with both full + lite evals: direct comparison
SELECT s.hn_id, s.title,
  full.hcb_editorial_mean as claude_e,
  lite.hcb_editorial_mean as llama_e,
  ROUND(full.hcb_editorial_mean - lite.hcb_editorial_mean, 3) as delta
FROM stories s
JOIN rater_evals full ON full.hn_id = s.hn_id AND full.prompt_mode = 'full'
JOIN rater_evals lite ON lite.hn_id = s.hn_id AND lite.prompt_mode = 'lite'
WHERE s.hn_id > 0
ORDER BY delta DESC LIMIT 20;

-- Consensus spread distribution (high spread = model disagreement)
SELECT
  CASE WHEN consensus_spread < 0.1 THEN '<0.1'
       WHEN consensus_spread < 0.2 THEN '0.1-0.2'
       WHEN consensus_spread < 0.3 THEN '0.2-0.3'
       ELSE '0.3+' END as spread_band,
  COUNT(*), ROUND(AVG(consensus_model_count),1)
FROM stories WHERE consensus_model_count >= 2
GROUP BY spread_band ORDER BY spread_band;
```

### How to detect prompt mode as a confound in corpus-level statistics

Any corpus-level statistic (avg HRCB, provision rankings, domain profiles)
should be computed separately for full and lite evals, then compared. If
they diverge significantly, the combined statistic is confounded.

```sql
-- Per-provision avg by prompt mode
SELECT rs.section, re.prompt_mode,
  ROUND(AVG(rs.editorial),3) as avg_e, COUNT(*) as n
FROM rater_scores rs
JOIN rater_evals re ON re.hn_id = rs.hn_id AND re.eval_model = rs.eval_model
WHERE rs.hn_id > 0
GROUP BY rs.section, re.prompt_mode
ORDER BY rs.section, re.prompt_mode;
```

---

## Mitigation Options (Conservative to Radical)

### 1. Status quo (current)
- Lite baseWeight 0.5 in consensus
- Lite evals don't promote eval_status to 'done'
- COALESCE fill-in: lite fills nulls only, never overwrites full
- **Risk**: Coverage-dependent bias persists silently

### 2. Mode-normalized scoring
- Compute a per-mode z-score normalization: for each prompt mode, normalize
  to zero mean and unit variance across the corpus
- Display and aggregate the normalized scores
- **Pro**: Removes systematic mode bias. Comparable across modes.
- **Con**: Loses absolute scale meaning. A normalized +1σ in lite isn't the
  same construct as +1σ in full.
- **Effort**: Medium — new column in rater_evals or computed at read time

### 3. Calibration-anchored correction
- Use the 15-URL calibration set to compute a per-model offset
- If Claude calibration avg is +0.25 and Llama calibration avg is +0.10,
  apply a +0.15 correction to Llama scores
- **Pro**: Grounded in shared reference set. Preserves absolute scale.
- **Con**: Requires running lite calibration on the same URLs. Current lite
  cal set exists (-2001 to -2015) but may not overlap with full cal set.
- **Effort**: Medium — extend calibration workflow

### 4. Prompt mode convergence (RADICAL)
- Develop a "lite-full" prompt that runs on Llama/Workers AI but produces
  per-section scores like the full prompt
- Current lite prompt was simplified for model capability — Llama 4 Scout
  may now be capable of the full schema
- **Pro**: Eliminates the measurement architecture difference entirely
- **Con**: Higher token cost on free tier, may hit Workers AI limits,
  requires validation that Llama produces valid full-schema output
- **Effort**: High — new prompt version, validation, recalibration

### 5. Display-level separation (RADICAL)
- Never combine full and lite scores in corpus statistics
- Show two parallel views: "Full eval corpus" and "Lite eval corpus"
- The homepage, signals page, and domain profiles each show both
- **Pro**: Honest. No hidden confounds.
- **Con**: Doubles the cognitive load. Users see two numbers everywhere.
- **Effort**: Medium — query changes + UI duplication

### 6. Auto-repair: retroactive full eval (RADICAL)
- When credits become available, automatically queue lite-only stories
  for full Claude evaluation
- Priority: stories with highest HN score that have only lite evals
- The full eval overwrites the lite fill-in scores
- Over time, the corpus converges toward full-eval coverage
- **Pro**: Self-healing. Coverage-dependent bias shrinks as data grows.
- **Con**: Requires sustained credit availability. May never reach 100%.
- **Effort**: Low — just a sweep handler that queries lite-only stories
  and enqueues them for full eval. The `sweepSkipped` pattern already exists.

---

## Recommendation

**Short term (launch)**: Status quo is acceptable. The 0.5 baseWeight and
the "Contested" badge (consensus_spread > 0.3) already surface disagreement.
Document the divergence honestly on the About page.

**Medium term (post-launch)**: Implement option 6 (auto-repair). Add a sweep
`sweep=upgrade_lite` that finds lite-only stories with hn_score > 50 and
enqueues them for Claude full eval. This is the most parsimonious fix —
it uses existing infrastructure and the bias shrinks naturally over time.

**Long term**: Implement option 3 (calibration-anchored correction) once
enough dual-eval stories exist to compute a reliable offset. This requires
~200 stories evaluated by both modes.

---

## Validation Warning Context

The 6,228 `rater_validation_warn` events are **not related to the divergence**.
They are Llama models failing to produce valid output for 1-2 sections per
eval (score out of range, malformed JSON). The validator catches this, rejects
those sections, and proceeds with valid sections. This is the system working
correctly. The rejection rate is ~1 section per eval on average, out of 31
possible — a 3% per-section failure rate. Acceptable for free-tier models.

## DeepSeek Context

DeepSeek v3.2 was disabled 2026-03-01 due to: "Zero successful evals. 25%
missing channels, 32% lower confidence, truncation at 17750 chars, 57 failures."
Its 812 rater_evals are excluded from consensus (enabled=0 filter in
updateConsensusScore). Historical data preserved for audit. No action needed.
