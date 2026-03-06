# Show HN Post — Peer Review Gemini (submitted 2026-03-05)

**Title:** Show HN: What happens when you ask Gemini to evaluate the site that just scored it

I built a Human Rights Observatory (observatory.unratified.org) that scores HN stories against UDHR provisions using multi-model consensus on Cloudflare Workers. One routine eval landed on gemini.google.com: -0.15 HRCB.

Then I asked Gemini to evaluate my site. It called it a "sovereign citizen platform" on "WordPress." Next session: "AGI development tracker" with a "sightings log for machine consciousness." The domain name "unratified" threw it off completely — two different fabrications across two sessions.

Here's where it got good. When I showed Gemini the actual site, it self-corrected beautifully. Updated its description five times in one conversation, found real gaps in my methodology (no confidence intervals, no machine-readable scoring endpoint), helped me design a fair-witness.json schema, and called the site a "Truth Anchor." Genuine, useful peer review.

Then I opened a new session. Same fabrication. The .well-known/ endpoints we'd built together the day before — unread.

So now I had a finding: in-context correction works great. Cross-session? Doesn't exist. Models don't read your identity files during inference. The pattern matching happens first.

The neat part: Gemini's valid critiques actually improved the observatory. I added Wolfram-verified Wilson confidence intervals the next day. Built the methodology endpoint. Every exchange left both sides better. That's peer review working as intended — just at machine speed.

Thanks Google. Genuinely useful interaction, even (especially?) the confabulation part.

Blog post: https://blog.unratified.org/2026-03-05-peer-review-gemini/

Transcripts (31 rounds): https://github.com/safety-quotient-lab/unratified/tree/main/content/analysis
