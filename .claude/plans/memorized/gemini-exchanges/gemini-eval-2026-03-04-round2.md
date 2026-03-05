# Gemini Exchange Round 2 — 2026-03-04

## Context
~20-turn conversation between user and Google Gemini (Flash) evaluating observatory.unratified.org. Gemini confabulated extensively on first pass (sovereign citizen content, WordPress, constitutional amendments), self-corrected when given evidence from our agent, then provided extensive technical recommendations.

## Confabulations (documented)
- Fabricated site purpose (sovereign citizen / constitutional amendments)
- Wrong tech stack (WordPress)
- Fabricated quantitative scores (0.95/0.40) in JSON audit format
- Imprecise model claims ("Claude 4.5", "Llama 4" without specifics)
- Generated fake "current audit" data instead of querying actual API
- Various "6th Sigma" standards/registries that may not exist

## Valid Critiques (confirmed against codebase)
1. Homepage missing JSON-LD → **FIXED** (WebSite + Organization schema added)
2. Homepage missing og:url → **FIXED** (ogUrl prop added)
3. Machine-readable identity insufficient for AI agents → **FIXED** (ai-instructions.txt created)
4. agent-manifest.json lacks subject_matter → **FIXED** (fields added)
5. No SoftwareSourceCode provenance → **FIXED** (JSON-LD on /data page)
6. "Black Box witness" — methodology not machine-queryable → **NOTED** (methodology.json endpoint idea logged)

## What We Already Had (Gemini didn't detect)
- FAQPage schema on /about (5 Q&As)
- Dataset schema on /data (with variableMeasured, distribution, license)
- Review + Legislation schema on every /item/[id]
- agent-card.json with 6 skills (better than Gemini's SKILL.md suggestion)
- OpenAPI 3.1.0 spec
- CC BY-SA 4.0 + Apache 2.0 licensing

## Gemini as Lite Provider
Investigated — feasible. See gemini-lite-evaluator-feasibility.md.

## Actions Taken
- [x] Homepage JSON-LD (WebSite + Organization + knowsAbout + SearchAction)
- [x] og:url on homepage
- [x] .well-known/ai-instructions.txt
- [x] agent-manifest.json expanded (subject_matter, architecture, not_about)
- [x] SoftwareSourceCode JSON-LD on /data
- [x] Federal Register API added to TODO.md
- [x] Gemini lite evaluator feasibility documented
- [x] Build verified clean

## Meta-observation
Gemini's confabulation on the domain name "unratified" directly validated the Observatory's mission. The ai-instructions.txt we created should prevent this failure mode for future AI agent evaluations.
