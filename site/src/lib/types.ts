// --- Content type slugs ---

export const CONTENT_TYPES: Record<string, { slug: string; label: string }> = {
  ED: { slug: 'editorial',    label: 'Editorial' },
  PO: { slug: 'policy',       label: 'Policy' },
  LP: { slug: 'landing-page', label: 'Landing Page' },
  PR: { slug: 'product',      label: 'Product' },
  AC: { slug: 'academic',     label: 'Academic' },
  MI: { slug: 'mission',      label: 'Mission' },
  AD: { slug: 'advertising',  label: 'Advertising' },
  HR: { slug: 'human-rights', label: 'Human Rights' },
  CO: { slug: 'community',    label: 'Community' },
  ME: { slug: 'media',        label: 'Media' },
  MX: { slug: 'mixed',        label: 'Mixed' },
};

export const CONTENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(CONTENT_TYPES).map(([code, { label }]) => [code, label])
);

export const CONTENT_TYPE_BY_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(CONTENT_TYPES).map(([code, { slug }]) => [slug, code])
);

// --- Classification slugs ---

export const CLASSIFICATIONS = [
  { slug: 'strong-positive',   label: 'Strong positive',   min: 0.7,  max: 1.0  },
  { slug: 'moderate-positive', label: 'Moderate positive', min: 0.4,  max: 0.6  },
  { slug: 'mild-positive',     label: 'Mild positive',     min: 0.1,  max: 0.3  },
  { slug: 'neutral',           label: 'Neutral',           min: -0.1, max: 0.1  },
  { slug: 'mild-negative',     label: 'Mild negative',     min: -0.3, max: -0.1 },
  { slug: 'moderate-negative', label: 'Moderate negative', min: -0.6, max: -0.4 },
  { slug: 'strong-negative',   label: 'Strong negative',   min: -1.0, max: -0.7 },
] as const;

export const CLASSIFICATION_BY_SLUG: Record<string, string> = Object.fromEntries(
  CLASSIFICATIONS.map(c => [c.slug, c.label])
);

export const CLASSIFICATION_TO_SLUG: Record<string, string> = Object.fromEntries(
  CLASSIFICATIONS.map(c => [c.label, c.slug])
);

// --- Error type slugs ---

export const ERROR_TYPES = {
  'http-400': { label: 'Bad Request',          status: 400 },
  'http-401': { label: 'Unauthorized',         status: 401 },
  'http-403': { label: 'Forbidden',            status: 403 },
  'http-404': { label: 'Not Found',            status: 404 },
  'http-410': { label: 'Gone',                 status: 410 },
  'http-429': { label: 'Rate Limited',         status: 429 },
  'http-451': { label: 'Unavailable For Legal Reasons', status: 451 },
  'http-5xx': { label: 'Server Error',         status: 500 },
  'timeout':  { label: 'Timeout',              status: null },
  'network':  { label: 'Network Error',        status: null },
  'dns':      { label: 'DNS Failure',          status: null },
  'ssl':      { label: 'SSL/TLS Error',        status: null },
  'blocked':  { label: 'Blocked',              status: null },
  'binary':   { label: 'Binary Content',       status: null },
  'empty':    { label: 'Content Too Short',    status: null },
} as const;

export type ErrorSlug = keyof typeof ERROR_TYPES;

export function errorSlugFromStatus(status: number): ErrorSlug {
  if (status === 400) return 'http-400';
  if (status === 401) return 'http-401';
  if (status === 403) return 'http-403';
  if (status === 404) return 'http-404';
  if (status === 410) return 'http-410';
  if (status === 429) return 'http-429';
  if (status === 451) return 'http-451';
  return 'http-5xx';
}

export function errorSlugFromException(err: unknown): ErrorSlug {
  const msg = String(err).toLowerCase();
  if (msg.includes('abort') || msg.includes('timeout')) return 'timeout';
  if (msg.includes('dns') || msg.includes('getaddrinfo') || msg.includes('enotfound')) return 'dns';
  if (msg.includes('ssl') || msg.includes('tls') || msg.includes('cert')) return 'ssl';
  return 'network';
}

// --- Interfaces ---

export interface Score {
  section: string;
  editorial: number | null;
  structural: number | null;
  combined: number | null;
  context_modifier: number | null;
  final: number | null;
  directionality: string[];
  evidence: string | null;
  note: string;
  witness_facts?: string[];
  witness_inferences?: string[];
  witness_ratio?: number;
}

export interface DcpElement {
  modifier: number | null;
  affects: string[];
  note: string;
}

export interface Evaluation {
  schema_version: string;
  evaluation: {
    url: string;
    domain: string;
    content_type: { primary: string; secondary: string[] };
    channel_weights: { editorial: number; structural: number };
    eval_depth: string;
    date: string;
    methodology: string;
    off_domain: boolean;
    external_evidence: boolean;
    operator: string;
  };
  domain_context_profile: {
    domain: string;
    eval_date: string;
    elements: Record<string, DcpElement>;
  };
  scores: Score[];
  aggregates: {
    weighted_mean: number;
    unweighted_mean: number;
    max: { value: number; section: string };
    min: { value: number; section: string };
    negative_count: number;
    nd_count: number;
    signal_sections: number;
    evidence_profile: Record<string, number>;
    channel_balance: Record<string, number>;
    directionality_profile: Record<string, number>;
    volatility: { value: number; label: string };
    classification: string;
  };
}
