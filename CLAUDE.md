# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository contains the UN Universal Declaration of Human Rights (UDHR) text and an evolving methodology for evaluating websites' compatibility with it. The methodology has progressed through three major versions (v1 → v2 → v3) and includes calibration data.

## Key Concepts

- **HCB (HR Compatibility Bias)**: The core measured construct (v3+). Measures the directional lean of web content relative to UDHR provisions.
- **Signal Channels**: Editorial (E) = what content says; Structural (S) = what the site does. Scored independently, combined with content-type-specific weights.
- **Domain Context Profile (DCP)**: Inherited modifiers from domain-level policies (privacy, ToS, accessibility, mission, ownership, access model, ad/tracking).
- **Off-domain toggle**: Controls whether linked off-domain content is evaluated. Default: OFF.

## File Structure

### Source Text
- `unudhr.txt` — Full UDHR text (Preamble + Articles 1-30)

### Website Lists
- `top-100-websites-2026-sfw.txt` — 90 SFW sites from Similarweb Jan 2026
- `top-100-websites-2026-nsfw.txt` — Full 100 sites including adult

### Methodology (version chain: v1 → v2 → v3 → v3.3 → v3.4)
- `methodology-v1.txt` — External-source methodology (finalized, used for v1 evals)
- `methodology-v2.txt` — On-domain-only methodology (superseded)
- `methodology-v3.txt` — Full HCB methodology spec (superseded by v3.3)
- `methodology-v3.1.prompt.md` — Self-contained LLM prompt for running evaluations
- `methodology-v3.3.txt` — Consolidation + roadmap (superseded by v3.4)
- `methodology-v3.4.txt` — **Current canonical reference**: adds batch protocol (B1), adversarial robustness (A5), machine-readable output (B8)

### Calibration
- `calibration-v3.1-set.txt` — 15-URL calibration set with expected score ranges
- `calibration-v3.1-baselines.txt` — Actual baseline evaluations for 9 calibration URLs

### Evaluations
- `kashifshah-net.txt` — v1 evaluation (external sources, single composite per article)
- `kashifshah-net.md` — Same in markdown
- `kashifshah-net-v2.txt` — v2 evaluation (on-domain only, off-domain toggle OFF)
- `top-100-sfw-udhr-evaluation.txt` — v1 evaluation of all 90 SFW sites

## Methodology Version Summary

| Version | Unit | Sources | Key Innovation |
|---------|------|---------|---------------|
| v1 | Domain | External reports | First evaluation framework |
| v2 | Domain | On-domain only | ND vs 0.0, evidence strength, off-domain toggle |
| v3 | URL | On-domain + context | HCB construct, E/S channels, content types, rubrics, calibration |
| v3.4 | URL | On-domain + optional external | Batch protocol, adversarial robustness layer, JSON/CSV output |
