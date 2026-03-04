# NewsGuard Research Access Request
**Date drafted:** 2026-03-04
**Status:** Draft — verify contact address before sending
**Suggested to:** research@newsguardtech.com (unverified — check newsguardtech.com/contact first)
**Alt contacts:** press@newsguardtech.com, or their researcher outreach form if one exists

---

**To:** research@newsguardtech.com
**Subject:** Research access request — HRCB construct validation against NewsGuard journalism criteria

Hi NewsGuard team,

I'm building [observatory.unratified.org](https://observatory.unratified.org), an open-source pipeline that evaluates Hacker News stories against the UN Universal Declaration of Human Rights. The project is Apache 2.0, run through the Safety Quotient Lab.

Two of the signals I'm trying to validate externally map almost exactly to your journalism criteria:

- **EQ (Epistemic Quality)** — sourcing, factual accuracy, evidence quality. Correlates with MBFC factual_reporting at ρ=+0.362 (p=0.098, n=22, marginal) — underpowered because MBFC only covers ~22 of the ~64 HN domains I have full evaluations for.
- **TQ (Transparency Quotient)** — five binary article-level indicators: author byline, publication date, sources cited, corrections policy visible, conflict of interest disclosed. These map directly to your criteria "Publishes bylines," "Corrects errors," and "Discloses ownership and financing." MBFC's outlet-level reliability label is the wrong construct for validating per-article transparency; your sub-scores are the right one.

I'm requesting research access to NewsGuard scores (ideally sub-criterion scores, not just the overall rating) for a list of ~200 domains in my corpus. In exchange:

- I'll share the full validation findings publicly (CC you on publication)
- The methodology is open source and would cite NewsGuard as the external criterion
- I'm happy to include NewsGuard in the methodology notes on the site

The corpus skews toward tech journalism (Ars Technica, The Register, Wired, MIT Tech Review) with some rights/investigative outlets (EFF, ProPublica, The Intercept). Happy to send the domain list if that's useful for scoping.

Does NewsGuard have a research access program, or a preferred way to handle this kind of request?

Thanks,
Kashif Shah
Safety Quotient Lab
observatory.unratified.org

---

## Context

- **Why NewsGuard over MBFC for TQ**: MBFC reliability_label confirmed as wrong construct (ρ=-0.094, n=24, content-type filter made no difference). NewsGuard's per-criterion scores ("Publishes bylines", "Corrects errors", "Discloses ownership") are the right external criterion for TQ.
- **Why NewsGuard over MBFC for EQ**: MBFC coverage ceiling is ~22 HN domains regardless of data accumulation. NewsGuard covers 10,000+ news sites — likely 5-10× more overlap with HN corpus.
- **Findings to share**: `findings/2026-03-04-eq-tq-external-validity-mbfc.md`
