# TODO

## Implemented (see IDEAS.md for inspiration sources)

### Job Stories Feed (TANSTAAFL)
- [x] Cron fetches /v0/jobstories.json
- [x] Job type filter on feed page and nav

### HN User Profiles (Competent Man)
- [x] Migration 0008: hn_users table
- [x] Cron crawls user profiles every 15 minutes
- [x] DB queries for poster stats
- [x] User profile page at /user/[username] (with fingerprint + SETL history)
- [ ] Karma vs HRCB correlation analysis on dashboard

### Feed Source Tracking (Seldon Index)
- [x] Migration 0009: story_feeds junction table
- [x] Cron records feed memberships (top/new/best/ask/show/job)
- [x] Per-feed HRCB stats query
- [x] Per-feed chart on Seldon Dashboard

### Enhanced Comments (Fnord Detector)
- [x] Migration 0010: depth + hn_score on story_comments
- [x] 2-level deep comment crawling
- [x] Threaded comment display on item page
- [ ] Deep comment crawling: recursive depth 2+ for high-engagement stories
- [ ] Comment refresh: re-crawl comments periodically for active discussions
- [ ] Comment score tracking over time
- [ ] Comment-level HRCB evaluation (divergence scoring)
- [ ] Aggregate comment sentiment vs story HRCB comparison

### Rights Correlation Network (Stephenson Rights Graph)
- [x] Force-directed graph at /network
- [x] Pearson correlation edges with threshold
- [x] Strongest correlations table
- [ ] Cluster detection (community finding algorithm)
- [ ] Temporal network evolution (how correlations shift)

### Domain Factions (Stackpole BattleTech)
- [x] Cosine similarity on 31-dim fingerprints at /factions
- [x] Greedy faction clustering
- [x] Alliance and rival tables
- [ ] Faction drift tracking over time
- [ ] Force-directed faction network visualization

### SETL Temporal Tracking (Chapel Perilous)
- [x] getDomainSetlHistory query
- [x] E/S/SETL line chart on domain detail pages
- [x] Global SETL trend on Seldon dashboard (with 7-day rolling average)
- [ ] Alert system for sudden SETL spikes

### Seldon Dashboard (Psychohistory)
- [x] Rolling 7-day and 30-day averages
- [x] Regime change detection (crossover points)
- [x] Per-feed HRCB chart
- [x] Per-content-type HRCB chart
- [ ] Per-article daily trends
- [ ] Confidence interval bands
- [ ] Real-world event annotation layer

### Velocity Tracking (Cayce Pollard)
- [x] Velocity queries from story_snapshots
- [x] Velocity vs HRCB scatter plot at /velocity
- [x] Fastest-rising stories table
- [x] Velocity sort on main feed
- [ ] Velocity alerts (stories hitting threshold)
- [ ] Velocity decay analysis

## Future Phases

### Local Image Generation
Set up local Stable Diffusion image generation using Hugging Face `diffusers` library.

- Install dependencies: `pip install diffusers transformers accelerate torch`
- Write a Python script for text-to-image generation
- Generate a pixelated PNG of a "nanite panther" in MTG artist style, modest resolution
- Save output to `test.png`
- Requires GPU with 6GB+ VRAM (12GB+ for FLUX.1 models)
