# Blog Requirements — unratified.org / Safety Quotient Lab

**Owner:** observatory.unratified.org (Safety Quotient Lab)
**For:** blog.unratified.org (infrastructure TBD — template agent to spec)
**Updated:** 2026-03-03

This document defines the requirements the blog platform and template must satisfy.
The other agent should read this, update their infrastructure spec accordingly, and
return a template spec (frontmatter schema + file conventions + rendering requirements).

---

## Platform context

- Blog lives at `blog.unratified.org` — part of the unratified.org ecosystem
- Org: Safety Quotient Lab (https://github.com/safety-quotient-lab)
- Sister properties: `observatory.unratified.org` (Astro + CF Pages), `unratified.org`
- Aesthetic: consistent with HN/BSD register — sparse, monospace, no flourish
- Infrastructure: static-site preferred (Astro or equivalent), CF Pages deployment

---

## Voice constraints (apply to all posts from this author)

- **E-Prime**: no forms of "to be" (is, are, was, were, been, being, be) in prose
- **No first-person singular** in published body: use "the builder" / "the author" or restructure
- **Exception**: HN companion posts use first person — different voice, different audience
- **Disclosure line** (mandatory footer): `Claude Code drafted this post; the author reviewed it.`

---

## Post anatomy (template must support all of these)

| Element | Notes |
|---|---|
| Lede | No heading — first paragraph is the hook |
| ASCII diagrams | Monospace, rendered in fenced code blocks |
| Section headers | H2 / H3 only |
| Prose sections | Standard markdown paragraphs |
| Tables | Vocabulary, failure modes, comparison |
| Footnotes | Academic-style, numbered `[^1]` — rendered at bottom |
| Caveats section | Structured self-critique, **mandatory** on all posts |
| Vocabulary section | Compressed-term table (phrase → what it triggers) |
| Personal note | Author-written stub, separate from AI-drafted body — rendered distinctly |
| Disclosure footer | "Claude Code drafted this post; the author reviewed it." |
| Companion link | Optional — links to HN companion post or sister artifact |

---

## Frontmatter schema (what we need the template agent to define)

We need the agent to specify the exact frontmatter keys and types. Our requirements:

```yaml
# Required
title: string
date: ISO-8601
status: draft | published
author: string          # "Safety Quotient Lab" or individual handle

# Recommended
description: string     # 1-2 sentence summary for og:description / feed
tags: string[]
companion_url: string   # HN thread, Show HN, or sister post URL

# Voice / rendering hints
voice: e-prime | standard
has_personal_note: boolean   # renders personal-note block distinctly
has_disclosure: boolean      # renders disclosure footer
```

Agent should adjudicate field naming, optionality, and any fields we missed.

---

## Content ready to publish

### 1. `cognitive-architecture.md`
- **Title:** "Not Prompt Engineering: Notes from Building a Rights Tool with an AI"
- **Status:** DRAFT v3 — body complete, personal note stub pending
- **Voice:** E-Prime, no first person
- **Length:** ~2,500 words
- **Elements present:** lede, 2 ASCII diagrams, 2 tables, 7 academic footnotes,
  caveats section, vocabulary section, disclosure line, personal note stub

**Pending fixes before publication** (see `TODO.md` — Blog post pre-publication fixes):
- [ ] T1 session-mode note: invert from "user states mode" to "AI infers mode, one confirmation question"
- [ ] Authorship disclosure footer — add explicitly (currently only in vocabulary section)
- [ ] Qualify Zettelkasten analogy — MEMORY.md uses routing rules not bidirectional links
- [ ] Verify arXiv:2310.13548 (Sharma et al. sycophancy paper) before publishing
- [ ] Extend caveats close — add self-referential observation: post produced by the architecture it describes

### 2. `hn-companion.md`
- **Title:** "Not Prompt Engineering: notes on designing a cognitive architecture for human-AI collaboration"
- **Status:** DRAFT v1
- **Depends on:** blog.unratified.org live + Observatory Show HN posted first
- **Timing:** submit 1-2 days after Observatory Show HN

---

## Publication workflow

1. Observatory Show HN posted first (`.claude/plans/show-hn-draft.md`)
2. Blog post published at blog.unratified.org
3. HN companion post (`hn-companion.md`) submitted 1-2 days later with blog URL

---

## What we need from the template agent

1. **Frontmatter schema** — canonical key names, types, required vs optional
2. **File conventions** — naming pattern, directory structure within the blog repo
3. **Rendering requirements** — how personal-note block renders, how disclosure footer renders,
   how ASCII diagrams render (preserve monospace), footnote rendering
4. **Platform spec** — Astro config, CF Pages setup, any dependencies
5. **Cross-linking** — how blog links back to observatory.unratified.org and unratified.org

Return the template spec as a file we can commit to `exports/blog/TEMPLATE-SPEC.md`
(or equivalent path in the other agent's repo).
