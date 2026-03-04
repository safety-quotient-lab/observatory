---
title: "Introducing Observatory: A Human Rights Lens for Tech News"
date: 2026-03-03
status: draft
tags: [observatory, udhr, human-rights, methodology, hrcb, setl, fair-witness]
voice: first-person (builder)
target: blog.unratified.org (introductory / evergreen post)
has_personal_note: true
---

# Introducing Observatory: A Human Rights Lens for Tech News

My health challenges limit how much I can work. I've come to think of Claude Code as an accommodation engine — not in the medical-paperwork sense, but in the literal one: it gives me the capacity to finish things that a normal work environment doesn't. Observatory was built in eight days because that kind of collaboration became possible for me. I even used Claude Code to write this post — but am only posting what resonates with me. The build process turned out to be as interesting as what it built; two companion posts explore the recursive methodology and what 806 evaluated stories reveal about tech journalism and human rights.

---

## What it is

Observatory automatically evaluates Hacker News front-page stories against all 31 provisions of the UN Universal Declaration of Human Rights — 30 articles and the Preamble. It runs continuously, updating every minute: https://observatory.unratified.org.

I started with HN because its human-curated front page is one of the few places on the internet where a story's presence signals something about quality, not just virality. The corpus is limited and self-selected — HN skews technical, educated, and English-speaking — but it's a tractable starting point for developing and stress-testing a methodology that can extend further.

---

## The observation that shaped the design

Rights violations rarely announce themselves. An article about a company's "privacy-first approach" might appear on a site running twelve trackers. A surveillance exposé might come from an outlet with no authorship disclosure. A piece about media trust might be published behind a paywall by a company with no funding transparency.

The interesting signal isn't whether an article mentions privacy, or transparency, or access to information. It's whether the site's own infrastructure matches its words.

This is the question the tool is built to answer.

---

## Two channels, not one

Each evaluation runs two parallel channels, scored independently before being combined.

**The editorial channel** scores what the content explicitly says about rights: which of the 31 provisions it touches, whether it leans toward or against them, and with what evidence strength. A story about surveillance policy might touch Article 12 (privacy) negatively and Article 19 (freedom of expression) positively — the channel captures both, with evidence cited for each.

**The structural channel** scores what the site infrastructure actually does: tracking pixels, paywalls, authorship disclosure, funding transparency, accessibility, ad density. This is the layer that reveals whether the platform publishing the content practices what it discusses.

The divergence between the two — SETL (Structural-Editorial Tension Level) — is often the most revealing number in an evaluation. It's a quantification of "says one thing, does another."

---

## Making it auditable: the Fair Witness layer

The hardest problem wasn't scoring. It was making LLM evaluations auditable enough to challenge.

The solution was a constraint called the Fair Witness layer (the same concept as fairwitness.bot, which appeared on HN and prompted me to name what I was already building): every evaluation must explicitly separate observable facts grounded in the page from interpretive conclusions drawn from those facts. The model can't just say "this article is privacy-negative." It has to say: "The article describes a surveillance program with no user consent mechanism (fact) — this is assessed as negative on Article 12 (inference)."

You get a ratio of facts to inferences (the FW Ratio) for every evaluation, and you can read the full evidence chain for every provision score. If a score looks wrong to you, you can follow the chain and identify exactly where the inference fails. No black boxes — which felt essential for a tool making normative claims about rights.

---

## What 805 stories showed

The aggregate patterns surprised me more than any individual score. Per our evaluations:

- **65% of stories identify their author.** One in three stories on HN's front page was published without a named author.
- **18% disclose conflicts of interest.**
- **44% assume domain-specific or expert knowledge** — which is worth reading as a structural note on Article 26 (the right to education, accessible knowledge) rather than just a readability metric.
- **Tech coverage is nearly 10× more retrospective than prospective.** We document past harm extensively; we discuss prevention rarely.

I'm genuinely uncertain how much to read into these numbers. They're from a specific corpus, evaluated by LLMs with known limitations, against a standard that reasonable people apply differently. But as patterns at scale, they're at least worth naming.

---

## One story that makes SETL concrete

"Half of Americans now believe that news organizations deliberately mislead them" appeared on HN with 652 points. The story itself scored +0.30 on the editorial channel — it observes a genuine rights concern about media trust and access to information.

The structural channel scored it −0.63. Fortune.com runs a paywall, user tracking, and no funding disclosure.

SETL: 0.84.

The system flagged a story about why people don't trust media, published by a media outlet whose own infrastructure demonstrates the pattern the story is reporting on.

---

## What doesn't work yet

I'm honest about the methodology's current limits, because I think transparency about limitations is part of what makes a tool like this trustworthy.

The structural channel for the free Llama models (Llama 4 Scout and Llama 3.3 70B on Workers AI) is currently noisy. 86% of structural scores cluster on just two integers — an artifact of how the prompt is structured for those models, not genuine signal variation. The direction I'm exploring is TQ (Transparency Quotient): replacing holistic structural scoring with binary, countable indicators that don't need LLM interpretation. Does this article name its author? Does it cite sources? Does it disclose funding? Note corrections? These are the most defensible claims a system like this can make.

More broadly: I don't know whether the aggregate patterns are valid enough to act on, or what dimensions I haven't thought to measure. My background is math and psychology at the undergraduate level, a decade in software, and autodidactism where the gaps show. Enough to build this; not enough to be confident the methodology is sound.

---

## How to engage with it

The feed is live and updates every minute. The most useful thing you can do:

Find a story whose score looks wrong to you. Open the detail page. Follow the per-provision evidence chain. Identify exactly where the inference fails — not just "this score seems off," but "the model cited X as evidence of Y, but X doesn't actually support Y." That specific failure mode is the one I haven't solved.

The full methodology, all prompts, and a 15-story calibration set are on the About page — including the parts that don't work well. The code is open source at https://github.com/safety-quotient-lab/observatory.

If you have expertise in psychometrics, NLP evaluation, or human rights scholarship, I'd genuinely like to hear where this is wrong.

---

*[PERSONAL NOTE — author to write]*

*Stub: Something about why the UDHR specifically, and what it means to build a tool about rights visibility while navigating systems that were not designed for someone like me.*
