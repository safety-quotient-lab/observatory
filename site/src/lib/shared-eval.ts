/**
 * Shared HRCB evaluation primitives.
 * Barrel re-export from split modules.
 *
 * Imported by src/lib/evaluate.ts (trigger endpoint), functions/cron.ts, and functions/consumer-*.ts.
 */

// --- Constants (kept here as canonical source) ---

export const EVAL_MAX_TOKENS = 10240;

/** Extended token budget for retry after stop_reason === 'end_turn' truncation */
export const EVAL_MAX_TOKENS_EXTENDED = 12288;

export const CONTENT_MAX_CHARS = 20_000;

export const RAW_HTML_MAX_CHARS = 30_000;

export const EVAL_MAX_TOKENS_LITE = 1024;

// --- Re-exports from split modules ---

export * from './eval-types';
export * from './models';
export * from './prompts';
export * from './eval-parse';
export * from './eval-write';
export * from './rater-health';
