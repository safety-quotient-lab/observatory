// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';

export const prerender = true;

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Human Rights Observatory API',
    version: '1.0.0',
    description: 'Public read-only API for the Human Rights Observatory — Hacker News stories evaluated against the 30 articles and Preamble of the UN Universal Declaration of Human Rights.',
    license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    contact: { name: 'Safety Quotient Lab', url: 'https://github.com/safety-quotient-lab' },
  },
  servers: [{ url: 'https://observatory.unratified.org', description: 'Production' }],
  paths: {
    '/api/v1/stories': {
      get: {
        summary: 'List evaluated stories',
        operationId: 'listStories',
        tags: ['Stories'],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0, minimum: 0 } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['score', 'date'], default: 'score' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['done', 'all'], default: 'done' } },
        ],
        responses: {
          '200': {
            description: 'Paginated story list',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                stories: { type: 'array', items: { $ref: '#/components/schemas/StorySummary' } },
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
              },
            } } },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/api/v1/story/{id}': {
      get: {
        summary: 'Get a story with rater evaluations',
        operationId: 'getStory',
        tags: ['Stories'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'Story with multi-model rater evaluations',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                story: { $ref: '#/components/schemas/StorySummary' },
                rater_evals: { type: 'array', items: { $ref: '#/components/schemas/RaterEval' } },
              },
            } } },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': { $ref: '#/components/responses/NotFound' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/v1/domains': {
      get: {
        summary: 'List domains with aggregated statistics',
        operationId: 'listDomains',
        tags: ['Domains'],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, minimum: 1, maximum: 100 } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['stories', 'score', 'setl'], default: 'stories' } },
        ],
        responses: {
          '200': {
            description: 'Domain aggregate list',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                domains: { type: 'array', items: { $ref: '#/components/schemas/DomainAggregate' } },
                total: { type: 'integer' },
                limit: { type: 'integer' },
              },
            } } },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/v1/domain/{domain}': {
      get: {
        summary: 'Get domain profile with recent stories',
        operationId: 'getDomain',
        tags: ['Domains'],
        parameters: [{ name: 'domain', in: 'path', required: true, schema: { type: 'string' }, example: 'github.com' }],
        responses: {
          '200': {
            description: 'Domain profile and recent stories',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                profile: { $ref: '#/components/schemas/DomainAggregate' },
                recent_stories: { type: 'array', items: { $ref: '#/components/schemas/StorySummary' } },
              },
            } } },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': { $ref: '#/components/responses/NotFound' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/v1/domain/{domain}/history': {
      get: {
        summary: 'Get daily HRCB profile snapshots for a domain',
        operationId: 'getDomainHistory',
        tags: ['Domains'],
        parameters: [
          { name: 'domain', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'days', in: 'query', schema: { type: 'integer', default: 30, minimum: 1, maximum: 365 } },
        ],
        responses: {
          '200': {
            description: 'Daily domain snapshots',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                domain: { type: 'string' },
                days: { type: 'integer' },
                snapshots: { type: 'array', items: { $ref: '#/components/schemas/DomainSnapshot' } },
              },
            } } },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': { $ref: '#/components/responses/NotFound' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/v1/users': {
      get: {
        summary: 'List users with aggregated statistics',
        operationId: 'listUsers',
        tags: ['Users'],
        parameters: [
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['stories', 'score', 'hrcb', 'karma', 'domains', 'eq', 'full_evaluated', 'editorial_full', 'editorial_lite'], default: 'stories' } },
          { name: 'min_stories', in: 'query', schema: { type: 'integer', default: 3, minimum: 1, maximum: 100 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, minimum: 1, maximum: 200 } },
        ],
        responses: {
          '200': {
            description: 'User aggregate list',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                users: { type: 'array', items: { $ref: '#/components/schemas/UserAggregate' } },
                total: { type: 'integer' },
                sort: { type: 'string' },
                min_stories: { type: 'integer' },
                limit: { type: 'integer' },
              },
            } } },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/v1/user/{username}': {
      get: {
        summary: 'Get a user profile',
        operationId: 'getUser',
        tags: ['Users'],
        parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'User aggregate profile',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: { user: { $ref: '#/components/schemas/UserAggregate' } },
            } } },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': { $ref: '#/components/responses/NotFound' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/v1/signals': {
      get: {
        summary: 'Get corpus-wide signal aggregates',
        operationId: 'getSignals',
        tags: ['Signals'],
        responses: {
          '200': {
            description: 'Transparency, accessibility, temporal, and tone aggregates',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                signals: {
                  type: 'object',
                  properties: {
                    stories_total: { type: 'integer' },
                    stories_evaluated: { type: 'integer' },
                    avg_hrcb: { type: ['number', 'null'] },
                    avg_setl: { type: ['number', 'null'] },
                    coverage_pct: { type: 'number' },
                    transparency: {
                      type: 'object',
                      properties: {
                        disclosed_count: { type: 'integer' },
                        disclosed_pct: { type: 'number' },
                        undisclosed_count: { type: 'integer' },
                        undisclosed_pct: { type: 'number' },
                      },
                    },
                    accessibility: {
                      type: 'object',
                      properties: {
                        accessible_pct: { type: 'number' },
                        moderate_jargon_pct: { type: 'number' },
                        high_jargon_pct: { type: 'number' },
                        assumed_knowledge: {
                          type: 'object',
                          properties: {
                            expert_pct: { type: 'number' },
                            specialist_pct: { type: 'number' },
                            general_pct: { type: 'number' },
                          },
                        },
                      },
                    },
                    temporal: {
                      type: 'object',
                      properties: {
                        retrospective_pct: { type: 'number' },
                        present_pct: { type: 'number' },
                        prospective_pct: { type: 'number' },
                        mixed_pct: { type: 'number' },
                      },
                    },
                    generated_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
            } } },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/v1/badge/{domain}.svg': {
      get: {
        summary: 'Get embeddable HRCB score badge for a domain',
        operationId: 'getDomainBadge',
        tags: ['Badges'],
        parameters: [
          { name: 'domain', in: 'path', required: true, schema: { type: 'string' }, description: 'Domain name (e.g., github.com)' },
          { name: 'label', in: 'query', schema: { type: 'string', default: 'HRCB' } },
        ],
        responses: {
          '200': { description: 'SVG badge', content: { 'image/svg+xml': { schema: { type: 'string' } } } },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/v1/export/stories.csv': {
      get: {
        summary: 'Export all evaluated stories as CSV (planned)',
        operationId: 'exportStoriesCsv',
        tags: ['Exports'],
        responses: { '501': { description: 'Not yet implemented' } },
      },
    },
    '/api/v1/export/stories.jsonl': {
      get: {
        summary: 'Export all evaluated stories as JSONL (planned)',
        operationId: 'exportStoriesJsonl',
        tags: ['Exports'],
        responses: { '501': { description: 'Not yet implemented' } },
      },
    },
    '/api/v1/export/domains.csv': {
      get: {
        summary: 'Export all domain signal profiles as CSV (planned)',
        operationId: 'exportDomainsCsv',
        tags: ['Exports'],
        responses: { '501': { description: 'Not yet implemented' } },
      },
    },
    '/api/v1/export/rater-evals.jsonl': {
      get: {
        summary: 'Export per-model evaluation records as JSONL (planned)',
        operationId: 'exportRaterEvalsJsonl',
        tags: ['Exports'],
        responses: { '501': { description: 'Not yet implemented' } },
      },
    },
    '/api/v0/topstories.json': {
      get: {
        summary: 'Top 500 story IDs by HN score (HN API-compatible)',
        operationId: 'getTopStories',
        tags: ['V0 Compatibility'],
        responses: {
          '200': { description: 'Array of HN story IDs', content: { 'application/json': { schema: { type: 'array', items: { type: 'integer' } } } } },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/v0/beststories.json': {
      get: {
        summary: 'Top 500 story IDs by HRCB score (HN API-compatible)',
        operationId: 'getBestStories',
        tags: ['V0 Compatibility'],
        responses: {
          '200': { description: 'Array of HN story IDs', content: { 'application/json': { schema: { type: 'array', items: { type: 'integer' } } } } },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/v0/newstories.json': {
      get: {
        summary: 'Top 500 most recent story IDs (HN API-compatible)',
        operationId: 'getNewStories',
        tags: ['V0 Compatibility'],
        responses: {
          '200': { description: 'Array of HN story IDs', content: { 'application/json': { schema: { type: 'array', items: { type: 'integer' } } } } },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/v0/item/{id}.json': {
      get: {
        summary: 'Get item with HN fields + HRCB extension (HN API-compatible)',
        operationId: 'getItem',
        tags: ['V0 Compatibility'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'HN-compatible item with hcb extension',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                type: { type: 'string' },
                by: { type: 'string' },
                time: { type: 'integer', description: 'Unix timestamp' },
                url: { type: 'string' },
                score: { type: 'integer' },
                title: { type: 'string' },
                descendants: { type: 'integer' },
                eval_status: { type: 'string' },
                hcb: {
                  type: 'object',
                  description: 'HRCB evaluation data (present when evaluated)',
                  properties: {
                    weighted_mean: { type: ['number', 'null'] },
                    editorial_mean: { type: ['number', 'null'] },
                    classification: { type: ['string', 'null'] },
                    eq_score: { type: ['number', 'null'] },
                    so_score: { type: ['number', 'null'] },
                    td_score: { type: ['number', 'null'] },
                    et_valence: { type: ['number', 'null'] },
                    et_arousal: { type: ['number', 'null'] },
                    et_primary_tone: { type: ['string', 'null'] },
                    eval_model: { type: ['string', 'null'] },
                    evaluated_at: { type: ['string', 'null'], format: 'date-time' },
                    eval_status: { type: 'string' },
                  },
                },
              },
            } } },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': { $ref: '#/components/responses/NotFound' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
  },
  components: {
    schemas: {
      StorySummary: {
        type: 'object',
        properties: {
          hn_id: { type: 'integer', description: 'Hacker News story ID' },
          url: { type: ['string', 'null'] },
          title: { type: 'string' },
          domain: { type: ['string', 'null'] },
          hn_score: { type: ['integer', 'null'], description: 'HN points' },
          hn_time: { type: 'integer', description: 'Unix timestamp' },
          hcb_weighted_mean: { type: ['number', 'null'], description: 'HRCB composite score [-1, +1]' },
          hcb_editorial_mean: { type: ['number', 'null'], description: 'Editorial channel score [-1, +1]' },
          hcb_classification: { type: ['string', 'null'], enum: ['strongly_positive', 'positive', 'neutral', 'negative', 'strongly_negative', null] },
          consensus_score: { type: ['number', 'null'], description: 'Multi-model ensemble score' },
          eval_model: { type: ['string', 'null'] },
          evaluated_at: { type: ['string', 'null'], format: 'date-time' },
          eq_score: { type: ['number', 'null'], description: 'Epistemic quality [-1, +1]' },
          so_score: { type: ['number', 'null'], description: 'Solution orientation [-1, +1]' },
          td_score: { type: ['number', 'null'], description: 'Transparency/disclosure [-1, +1]' },
          et_valence: { type: ['number', 'null'], description: 'Emotional valence [-1, +1]' },
          et_arousal: { type: ['number', 'null'], description: 'Emotional arousal [-1, +1]' },
          et_primary_tone: { type: ['string', 'null'], description: "Russell's Circumplex tone" },
        },
      },
      DomainAggregate: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          story_count: { type: 'integer' },
          evaluated_count: { type: 'integer' },
          avg_hrcb: { type: ['number', 'null'] },
          avg_setl: { type: ['number', 'null'] },
          avg_editorial: { type: ['number', 'null'] },
          avg_structural: { type: ['number', 'null'] },
          avg_eq: { type: ['number', 'null'] },
          avg_so: { type: ['number', 'null'] },
          avg_td: { type: ['number', 'null'] },
          avg_pt_count: { type: ['number', 'null'] },
          avg_valence: { type: ['number', 'null'] },
          avg_arousal: { type: ['number', 'null'] },
          dominant_tone: { type: ['string', 'null'] },
          dominant_scope: { type: ['string', 'null'] },
          last_updated_at: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      DomainSnapshot: {
        type: 'object',
        properties: {
          snapshot_date: { type: 'string', format: 'date' },
          story_count: { type: 'integer' },
          evaluated_count: { type: 'integer' },
          avg_hrcb: { type: ['number', 'null'] },
          avg_setl: { type: ['number', 'null'] },
          avg_editorial: { type: ['number', 'null'] },
          avg_structural: { type: ['number', 'null'] },
          avg_eq: { type: ['number', 'null'] },
          avg_so: { type: ['number', 'null'] },
          avg_td: { type: ['number', 'null'] },
          avg_valence: { type: ['number', 'null'] },
          avg_arousal: { type: ['number', 'null'] },
          dominant_tone: { type: ['string', 'null'] },
          avg_confidence: { type: ['number', 'null'] },
          avg_sr: { type: ['number', 'null'] },
          avg_pt_count: { type: ['number', 'null'] },
          avg_pt_score: { type: ['number', 'null'] },
          avg_fw_ratio: { type: ['number', 'null'] },
          dominant_scope: { type: ['string', 'null'] },
          dominant_reading_level: { type: ['string', 'null'] },
          dominant_sentiment: { type: ['string', 'null'] },
        },
      },
      UserAggregate: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          stories: { type: 'integer' },
          karma: { type: ['integer', 'null'] },
          domains: { type: 'integer' },
          avg_hrcb: { type: ['number', 'null'] },
          avg_editorial_full: { type: ['number', 'null'], description: 'Mean editorial score from full evaluations' },
          avg_editorial_lite: { type: ['number', 'null'], description: 'Mean editorial score from lite evaluations' },
          eq_score: { type: ['number', 'null'] },
          full_evaluated: { type: 'integer' },
          lite_evaluated: { type: 'integer' },
        },
      },
      RaterEval: {
        type: 'object',
        properties: {
          eval_model: { type: 'string' },
          eval_provider: { type: 'string' },
          prompt_mode: { type: 'string', enum: ['full', 'lite'] },
          eval_status: { type: 'string' },
          hcb_editorial_mean: { type: ['number', 'null'] },
          hcb_weighted_mean: { type: ['number', 'null'] },
          evaluated_at: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      Error: {
        type: 'object',
        description: 'RFC 7807 Problem Details',
        properties: {
          type: { type: 'string', format: 'uri' },
          title: { type: 'string' },
          status: { type: 'integer' },
        },
        required: ['type', 'title', 'status'],
      },
    },
    responses: {
      BadRequest: { description: 'Invalid request parameters', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Error' } } } },
      NotFound: { description: 'Resource not found', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Error' } } } },
      RateLimited: {
        description: 'Rate limit exceeded (200 requests/hour per IP)',
        headers: { 'Retry-After': { schema: { type: 'integer', example: 3600 } } },
        content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Unavailable: { description: 'Service temporarily unavailable', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
  },
  tags: [
    { name: 'Stories', description: 'Evaluated Hacker News stories with HRCB scores' },
    { name: 'Domains', description: 'Domain-level aggregated rights profiles' },
    { name: 'Users', description: 'HN submitter aggregated statistics' },
    { name: 'Signals', description: 'Corpus-wide signal aggregates' },
    { name: 'Badges', description: 'Embeddable SVG score badges' },
    { name: 'Exports', description: 'Bulk data exports (planned — currently returns 501)' },
    { name: 'V0 Compatibility', description: 'HN Firebase API-compatible endpoints' },
  ],
  externalDocs: {
    description: 'Methodology and documentation',
    url: 'https://observatory.unratified.org/about',
  },
};

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(spec, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
