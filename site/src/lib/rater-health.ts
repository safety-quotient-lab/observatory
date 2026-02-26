/**
 * Per-model health state tracking for rater models.
 */

export interface RaterHealthState {
  consecutive_failures: number;
  consecutive_parse_failures: number;
  total_attempts: number;
  total_successes: number;
  total_parse_failures: number;
  total_api_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  disabled_at: string | null;
  disabled_reason: string | null;
}

export const PARSE_FAILURE_DISABLE_THRESHOLD = 5;
export const FAILURE_RATE_DISABLE_THRESHOLD = 0.7;
export const FAILURE_RATE_MIN_ATTEMPTS = 20;
export const AUTO_DISABLE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

export function emptyRaterHealth(): RaterHealthState {
  return {
    consecutive_failures: 0,
    consecutive_parse_failures: 0,
    total_attempts: 0,
    total_successes: 0,
    total_parse_failures: 0,
    total_api_failures: 0,
    last_success_at: null,
    last_failure_at: null,
    disabled_at: null,
    disabled_reason: null,
  };
}

export function raterHealthKvKey(modelId: string): string {
  return `rater_health:${modelId}`;
}

export function shouldSkipModel(health: RaterHealthState): { skip: boolean; reason?: string; probe?: boolean } {
  if (!health.disabled_at) return { skip: false };
  const disabledMs = new Date(health.disabled_at).getTime();
  if (Date.now() - disabledMs < AUTO_DISABLE_COOLDOWN_MS) {
    return { skip: true, reason: health.disabled_reason ?? 'auto-disabled' };
  }
  // Cooldown passed — allow one probe
  return { skip: false, probe: true };
}

export function updateRaterHealthOnSuccess(health: RaterHealthState): RaterHealthState {
  return {
    ...health,
    consecutive_failures: 0,
    consecutive_parse_failures: 0,
    total_attempts: health.total_attempts + 1,
    total_successes: health.total_successes + 1,
    last_success_at: new Date().toISOString(),
    disabled_at: null,
    disabled_reason: null,
  };
}

export function updateRaterHealthOnParseFailure(health: RaterHealthState): RaterHealthState {
  const updated: RaterHealthState = {
    ...health,
    consecutive_failures: health.consecutive_failures + 1,
    consecutive_parse_failures: health.consecutive_parse_failures + 1,
    total_attempts: health.total_attempts + 1,
    total_parse_failures: health.total_parse_failures + 1,
    last_failure_at: new Date().toISOString(),
  };
  // Auto-disable check
  if (updated.consecutive_parse_failures >= PARSE_FAILURE_DISABLE_THRESHOLD) {
    updated.disabled_at = new Date().toISOString();
    updated.disabled_reason = `${updated.consecutive_parse_failures} consecutive parse failures`;
  } else if (updated.total_attempts >= FAILURE_RATE_MIN_ATTEMPTS) {
    const failRate = (updated.total_parse_failures + updated.total_api_failures) / updated.total_attempts;
    if (failRate >= FAILURE_RATE_DISABLE_THRESHOLD) {
      updated.disabled_at = new Date().toISOString();
      updated.disabled_reason = `${(failRate * 100).toFixed(0)}% failure rate over ${updated.total_attempts} attempts`;
    }
  }
  return updated;
}

export function updateRaterHealthOnApiFailure(health: RaterHealthState): RaterHealthState {
  const updated: RaterHealthState = {
    ...health,
    consecutive_failures: health.consecutive_failures + 1,
    total_attempts: health.total_attempts + 1,
    total_api_failures: health.total_api_failures + 1,
    last_failure_at: new Date().toISOString(),
  };
  return updated;
}
