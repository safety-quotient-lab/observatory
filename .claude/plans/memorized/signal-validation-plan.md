# Signal Validation Plan
**Created:** 2026-03-04
**Status:** Active
**Scope:** All 13 signals — HRCB, SETL, EQ, SO, SR, ET, TD, PT, FW, TF, GS, CL, TQ

Companion to `construct-validity-analysis.md` and `findings/`.
Tracks what validation has been done, what's next, and what each check requires.

---

## Validation status summary

| Signal | Done | Next check | Gating condition |
|--------|------|-----------|-----------------|
| HRCB | Known-groups ✓ Discriminant ✓ Test-retest ✓ | External (NewsGuard) | NewsGuard access |
| EQ | MBFC marginal (ρ=+0.362, exhausted) | NewsGuard journalism criteria | NewsGuard access |
| ET-valence | VADER convergent (r=+0.376, weak) | Human ratings (n=50) | None — can do now |
| PT | Inter-rater κ=0.325 FAIR | Technique-level validation | None — can do now |
| CL | FK convergent FAIL (wrong validator) | Human ratings | None — can do now |
| TQ | MBFC reliability NULL (construct mismatch) | NewsGuard sourcing sub-scores | NewsGuard access |
| SETL | None | Internal consistency + face validity | None — can do now |
| SO | None | Known-groups + inter-rater | None — can do now |
| SR | None | Known-groups + inter-rater | None — can do now |
| TD | None | Known-groups + inter-rater | None — can do now |
| FW | None | Known-groups + inter-rater | None — can do now |
| TF | None | Inter-rater reliability | None — can do now |
| GS | None | Inter-rater reliability | None — can do now |
| ET-arousal | None | Human ratings (no automated proxy) | None — can do now |

---

## Checks completable now (no external gating)

### 1. ET-valence — human ratings validation
**Priority:** HIGH (weak VADER result needs follow-up)
**Method:** Sample 50 done stories. Export title + content snippet. Rate sentiment -1/0/+1 manually (or use researcher time). Compare to `et_valence` scores via Spearman ρ.
**Why better than VADER:** VADER is descriptive (measures emotional language); ET is normative (measures what the content implies about its subject). Human ratings can be instructed to use the normative framing.
**Effort:** M (50 manual ratings + query + correlation)
**Success threshold:** ρ ≥ 0.40, p < 0.05

### 2. PT — technique-level validation
**Priority:** HIGH (κ=0.325 is fair but technique-level agreement may vary)
**Method:** Sample 30 stories flagged with PT. For each, list detected techniques. Have a second rater (human or different LLM) independently classify. Compute per-technique precision/recall vs gold standard.
**External criterion:** PTC-18 labeled corpus (Rashkin et al. ACL 2019) — check if any of our flagged stories overlap with their test set.
**Effort:** M
**Success threshold:** Macro-F1 ≥ 0.50 across common techniques

### 3. CL — human ratings validation
**Priority:** HIGH (FK failed because FK measures syntax not expertise)
**Method:** Sample 40 stories (stratified by cl_reading_level). Rate each on a 3-point domain expertise scale (general public / informed layperson / domain expert). Compare to `cl_assumed_knowledge` via Spearman ρ.
**Effort:** M (40 manual ratings)
**Success threshold:** ρ ≥ 0.40, p < 0.05

### 4. SETL — internal consistency check
**Priority:** MEDIUM
**Method (automated):**
  a. Verify SETL is computed correctly: sample 20 high-SETL stories, confirm E and S channels are genuinely discrepant (E >> S or S >> E) by reading the hcb_json.
  b. Domain-level check: high-SETL domains should be corporate/commercial (high structural negative, positive editorial). Compute mean SETL by known-groups (EP/EN/EC).
  c. Check SETL distribution — if unimodal near 0, construct may not be differentiating.
**Effort:** S (queries + manual spot-check)
**Success threshold:** EC group mean SETL > EP group (corporate sites "say better than they do")

### 5. SO (Solution Orientation) — known-groups + inter-rater
**Priority:** MEDIUM
**Known-groups method:** EP (rights advocacy) outlets should score higher SO (advocacy = solution-framed) than EC (corporate = problem-amplifying for business case). Query `AVG(so_score)` by known-groups. Kruskal-Wallis.
**Inter-rater:** Sample 30 stories, rate "primarily solution-oriented" vs "primarily problem-focused" (binary). Cohen's κ vs LLM SO score (binarized at threshold).
**Effort:** S (known-groups auto) + M (inter-rater manual)
**Success threshold:** Known-groups p < 0.05; κ ≥ 0.40

### 6. SR (Stakeholder Representation) — known-groups + inter-rater
**Priority:** MEDIUM
**Known-groups method:** Investigative/advocacy journalism (EP) should score higher SR (multi-source reporting). Corporate blogs (EC) should be lowest (single-org perspective). Query `AVG(sr_score)` by known-groups.
**Inter-rater:** Sample 30 stories, count perspectives (1/2/3+ distinct stakeholder types). Spearman ρ vs sr_score.
**Effort:** S (known-groups auto) + M (inter-rater manual)
**Success threshold:** Known-groups p < 0.05; ρ ≥ 0.40

### 7. TD (Transparency/Disclosure) — known-groups + inter-rater
**Priority:** MEDIUM
**Known-groups method:** EP outlets (EFF, ProPublica) have explicit methodology sections. EC outlets (Google Blog) rarely disclose funding/conflicts. Query `AVG(td_score)` by known-groups.
**Note:** TD and TQ measure overlapping constructs at different granularities. Check correlation between td_score and tq_score where both are available. If r > 0.6, consider whether both are needed.
**Effort:** S (known-groups auto) + S (td/tq correlation)
**Success threshold:** Known-groups p < 0.05

### 8. FW (Fair Witness ratio) — known-groups
**Priority:** MEDIUM
**Known-groups method:** Scientific journalism (newscientist.com, nature.com) should have higher FW ratios (evidence-based, fewer inferential leaps) than opinion/advocacy (motherjones.com). Query `AVG(fw_ratio)` by known-groups.
**Effort:** S (automated, we have the data)
**Success threshold:** Known-groups p < 0.05; qualitative face validity on top/bottom domains

### 9. TF (Temporal Framing) — inter-rater reliability
**Priority:** LOW
**Method:** Sample 30 done stories. Human rates each: retrospective / present-focused / prospective / mixed. Cohen's κ vs `tf_primary_focus`.
**Alternative (automated):** Check if retrospective stories are older (by HN submission date relative to events). Prospective stories should contain future-tense language — compare tf framing to presence of future-tense verbs in stored content.
**Effort:** S (automated proxy) or M (human inter-rater)
**Success threshold:** κ ≥ 0.40 (human); automated: ρ ≥ 0.30 (proxy is weaker)

### 10. GS (Geographic Scope) — inter-rater reliability
**Priority:** LOW
**Method:** Sample 30 done stories. Human rates each: local / national / international. Cohen's κ vs `gs_scope`.
**Alternative (automated):** International stories should mention more country names. Named entity recognition (spaCy) on stored content — count distinct country/region mentions. Spearman ρ vs gs scope ordinal.
**Effort:** S (automated proxy) or M (human inter-rater)
**Success threshold:** κ ≥ 0.40 (human); NER proxy: ρ ≥ 0.40

### 11. ET-arousal — human ratings
**Priority:** LOW (no automated proxy exists for Russell's arousal)
**Method:** Sample 30 stories. Human rates each on emotional intensity: low / medium / high. Spearman ρ vs `et_arousal`.
**Why no automated proxy:** VADER doesn't measure intensity. LIWC has affect measures but not arousal specifically. NRC has valence/arousal but is word-level and misses structural context.
**Effort:** M
**Success threshold:** ρ ≥ 0.40, p < 0.05

---

## Checks gated on NewsGuard access

### 12. EQ — NewsGuard journalism criteria
**Gate:** NewsGuard research access (email drafted: `.claude/plans/exports/newsguard-research-access-email.md`)
**Method:** Match our 64 full-eval domains against NewsGuard's 9 per-criterion scores. Primary: "Gathers and presents information responsibly" + "Cites credible sources" criteria → Spearman ρ vs avg_eq. Secondary: overall NewsGuard score.
**Why better than MBFC:** MBFC covers only ~22 HN domains (ceiling hit). NewsGuard covers 10,000+ outlets, likely 5-10× more HN domain overlap. NewsGuard criteria directly measure epistemic quality, not just political bias.
**Success threshold:** ρ ≥ 0.40, p < 0.05 (n ≥ 40 expected)

### 13. TQ — NewsGuard sourcing/transparency sub-scores
**Gate:** NewsGuard research access
**Method:** Filter our TQ scores to `content_type IN ('ED','HR','MI')`. Match domains against NewsGuard "Publishes bylines" + "Discloses ownership and financing" + "Corrects errors" criteria. Spearman ρ vs avg_tq (ED/HR/MI filtered).
**Why better than MBFC:** MBFC reliability_label is outlet-level information quality, not per-article transparency. NewsGuard's individual criteria ("Publishes bylines", "Corrects errors") map directly to TQ's 5 indicators.
**Success threshold:** ρ ≥ 0.35, p < 0.05

### 14. HRCB — NewsGuard external validity
**Gate:** NewsGuard research access
**Method:** Match domain avg_hrcb against NewsGuard overall scores. Weaker hypothesis than EQ/TQ (HRCB is broader than journalism quality) but worth computing if we have access.
**Expected result:** Moderate positive correlation (not strong — human rights alignment ≠ journalism quality, but they covary).
**Success threshold:** ρ ≥ 0.25, p < 0.10 (lower bar — construct distance is real)

---

## Sequencing

**Phase A — Automated (no human raters, no external data):**
Run in parallel: SETL internal consistency (check 4), SO/SR/TD known-groups (checks 5-7), FW known-groups (check 8), TF/GS automated proxies (checks 9-10 automated variant).
Effort: ~2-3 hours. All can be done in one session.

**Phase B — Human raters (requires researcher time):**
ET-valence ratings (check 1), PT technique-level (check 2), CL expertise ratings (check 3), ET-arousal (check 11), TF/GS inter-rater (checks 9-10 human variant).
Effort: 1-2 days of manual work.

**Phase C — NewsGuard (gated):**
EQ, TQ, HRCB external validity (checks 12-14).
Effort: S after data received (scripts already exist, modify for NewsGuard schema).

---

## Notes on inter-signal relationships

- **TD vs TQ:** Overlapping constructs. TD is full-eval holistic; TQ is lite-eval 5-binary. Compute correlation when both available for same story (should be r > 0.5 if measuring same thing).
- **EQ vs FW:** FW measures evidence structure (observable:inferential ratio); EQ measures epistemic quality more broadly. Should be moderately correlated (r = 0.3-0.5 expected) but not redundant.
- **SO vs SR:** Orthogonal by design. High SO + low SR = advocacy without breadth. Query correlation — should be low (r < 0.3).
- **ET vs HRCB:** Expected to be correlated (negative-HRCB stories tend toward negative-ET) but discriminant (r < 0.6). Already validated: discriminant validity confirmed (r=0.08 for HRCB vs sentiment, though that used a different sentiment measure).
