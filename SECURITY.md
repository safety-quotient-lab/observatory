# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in this project, please report it responsibly through one of these channels:

1. **GitHub Security Advisories** (preferred):
   [Report a vulnerability](https://github.com/safety-quotient-lab/observatory/security/advisories/new)

2. **Email**: kashif@safetyquotient.org

Please do **not** open a public issue for security vulnerabilities.

## Scope

This project runs on Cloudflare Workers. The wrangler configuration files contain infrastructure resource IDs (D1 database, KV namespace, R2 bucket) which are **not secrets** — they are intentionally committed and annotated with "Fork setup" comments. Actual secrets (API keys, trigger tokens) are stored in environment variables and `.dev.vars` (gitignored).

## Response

I aim to acknowledge security reports within 48 hours and provide a fix or mitigation plan within 7 days for confirmed vulnerabilities.

