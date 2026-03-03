# HRO — Site & Pipeline

Astro 5 SSR frontend + Cloudflare Workers pipeline for the [Human Rights Observatory](https://observatory.unratified.org).

For full architecture, build/deploy commands, storage schema, and key patterns — see **[`CLAUDE.md`](CLAUDE.md)**.

## Quick start

```bash
# Install
npm install

# Dev server (requires .dev.vars — see below)
npx astro dev

# Build
npx astro build

# Deploy site
npx wrangler pages deploy dist --project-name hn-hrcb

# Deploy workers
npx wrangler deploy --config wrangler.cron.toml
npx wrangler deploy --config wrangler.consumer-anthropic.toml
npx wrangler deploy --config wrangler.consumer-openrouter.toml
npx wrangler deploy --config wrangler.consumer-workers-ai.toml
npx wrangler deploy --config wrangler.dlq.toml
```

## Secrets

Create `site/.dev.vars` (gitignored) with:

```
TRIGGER_SECRET=...
ANTHROPIC_API_KEY=...
OPENROUTER_API_KEY=...
```

Never commit `.dev.vars`.
