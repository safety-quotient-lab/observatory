# Attribution

This project builds on the following works and data sources.

## Universal Declaration of Human Rights

The UDHR text (Preamble + Articles 1-30) was adopted by the United Nations
General Assembly on 10 December 1948 (resolution 217 A III). The text is in
the public domain. Source: https://www.un.org/en/about-us/universal-declaration-of-human-rights

## Academic Frameworks

The evaluation methodology references and operationalizes the following
published frameworks:

- **Propaganda Techniques Corpus (PTC-18)**
  Da San Martino, G., Yu, S., Barron-Cedeno, A., Petrov, R., & Nakov, P. (2019).
  "Fine-Grained Analysis of Propaganda in News Articles."
  *Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing.*

- **CRAAP Test**
  Meriam Library, California State University, Chico.
  Adapted for epistemic quality assessment. Public domain educational framework.

- **Russell's Circumplex Model of Affect**
  Russell, J. A. (1980). "A circumplex model of affect."
  *Journal of Personality and Social Psychology, 39*(6), 1161-1178.
  Applied for emotional tone assessment (Valence-Arousal-Dominance dimensions).

## Data Sources

- **Hacker News** — Story metadata sourced from the Hacker News public API
  (https://github.com/HackerNews/API). Hacker News is operated by Y Combinator.

- **Algolia HN Search** — Historical story backfill via Algolia's HN Search API
  (https://hn.algolia.com/api).

## AI Models

Evaluation results are generated using:

- **Claude** by Anthropic (https://anthropic.com) — primary evaluation model
- **Open-source models** via OpenRouter and Cloudflare Workers AI — consensus scoring

Per Anthropic's Terms of Service, users retain rights to model outputs.
Per OpenRouter and Cloudflare Terms of Service, users retain rights to outputs.

## Development Tools

This project is built with the assistance of **Claude Code** by Anthropic
(https://claude.ai/code).

## Infrastructure

Built on Cloudflare Workers, D1, KV, R2, and Queues.
Site framework: Astro (https://astro.build).
