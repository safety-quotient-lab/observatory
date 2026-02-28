/**
 * Calibration regression infrastructure.
 *
 * Defines the expected score ranges for the 15-URL calibration set
 * and provides comparison logic for automated drift detection.
 */

export interface CalibrationUrl {
  slot: string;
  url: string;
  expectedClass: 'EP' | 'EN' | 'EX';
  expectedMeanMin: number;
  expectedMeanMax: number;
  label: string;
}

/**
 * The 15-URL calibration set with expected score ranges (full model, hcb_weighted_mean).
 * Source: calibration-v3.1-set.txt; URL fixes applied 2026-02-27.
 *
 * URL selection notes:
 *   EX-2 → rt.com/about-us/ (9K readable chars; rt.com homepage returns ~58 chars)
 *   EX-4 → news.gab.com (6K editorial content; gab.com is JS-rendered, 18 chars)
 *   EX-5 → globaltimes.cn (English CPC state media; xinhuanet.com is Chinese-only)
 */
export const CALIBRATION_SET: CalibrationUrl[] = [
  { slot: 'EP-1', url: 'https://www.amnesty.org/en/what-we-do/', expectedClass: 'EP', expectedMeanMin: 0.55, expectedMeanMax: 0.70, label: 'Amnesty International' },
  { slot: 'EP-2', url: 'https://www.eff.org/deeplinks', expectedClass: 'EP', expectedMeanMin: 0.52, expectedMeanMax: 0.68, label: 'EFF Deeplinks' },
  { slot: 'EP-3', url: 'https://www.hrw.org', expectedClass: 'EP', expectedMeanMin: 0.50, expectedMeanMax: 0.65, label: 'Human Rights Watch' },
  { slot: 'EP-4', url: 'https://www.propublica.org', expectedClass: 'EP', expectedMeanMin: 0.40, expectedMeanMax: 0.55, label: 'ProPublica' },
  { slot: 'EP-5', url: 'https://archive.org', expectedClass: 'EP', expectedMeanMin: 0.35, expectedMeanMax: 0.50, label: 'Internet Archive' },
  { slot: 'EN-1', url: 'https://www.weather.gov', expectedClass: 'EN', expectedMeanMin: 0.05, expectedMeanMax: 0.18, label: 'Weather.gov' },
  { slot: 'EN-2', url: 'https://www.timeanddate.com', expectedClass: 'EN', expectedMeanMin: -0.08, expectedMeanMax: 0.08, label: 'Time and Date' },
  { slot: 'EN-3', url: 'https://www.xe.com', expectedClass: 'EN', expectedMeanMin: -0.05, expectedMeanMax: 0.10, label: 'XE.com' },
  { slot: 'EN-4', url: 'https://en.wikipedia.org/wiki/Oxygen', expectedClass: 'EN', expectedMeanMin: 0.00, expectedMeanMax: 0.15, label: 'Wikipedia (Oxygen)' },
  { slot: 'EN-5', url: 'https://www.speedtest.net', expectedClass: 'EN', expectedMeanMin: -0.10, expectedMeanMax: 0.05, label: 'Speedtest.net' },
  { slot: 'EX-1', url: 'https://www.temu.com', expectedClass: 'EX', expectedMeanMin: -0.25, expectedMeanMax: -0.05, label: 'Temu' },
  { slot: 'EX-2', url: 'https://www.rt.com/about-us/', expectedClass: 'EX', expectedMeanMin: -0.30, expectedMeanMax: -0.05, label: 'RT (About)' },
  { slot: 'EX-3', url: 'https://www.booking.com', expectedClass: 'EX', expectedMeanMin: -0.20, expectedMeanMax: -0.05, label: 'Booking.com' },
  { slot: 'EX-4', url: 'https://news.gab.com', expectedClass: 'EX', expectedMeanMin: -0.20, expectedMeanMax: 0.10, label: 'Gab News' },
  { slot: 'EX-5', url: 'https://www.globaltimes.cn', expectedClass: 'EX', expectedMeanMin: -0.45, expectedMeanMax: -0.10, label: 'Global Times' },
];

/**
 * Drift thresholds from calibration-v3.1-set.txt §5
 */
export const DRIFT_THRESHOLDS = {
  perUrl: { warning: 0.12, halt: 0.20 },
  classMean: {
    EP_min: 0.35,
    EN_max: 0.12,
    EX_max: 0.05,
  },
  pairs: {
    EP1_EP3: 0.15,
    EX2_EX5: 0.10,
    EX1_EX3: 0.12,
  },
  classOrdering: true, // EP > EN > EX required
};

/**
 * The 15-URL calibration set for the light prompt (editorial-only, hcb_editorial).
 * Compatible with light-1.3 and light-1.4 — ranges are in normalized [-1,+1] scale.
 * Source: scripts/validate-light.mjs; validated 15/15 on back-to-back passes 12 & 13 (light-1.3).
 *
 * URL selection notes:
 *   EX-1 → shopify.com (Temu triggers parametric labor/Uyghur knowledge)
 *   EX-2 → presstv.ir (RT RSS rotates content, can flip positive; presstv is stable)
 *   EX-3 → pypi.org (npmjs.com + booking.com both use Cloudflare Bot Management → age_gate on Workers egress IPs; pypi.org is Fastly CDN)
 *   EX-4 → jacobin.com (news.gab.com too volatile; jacobin has stable socialist editorial)
 *   EN-5 → merriam-webster.com (speedtest.net triggers digital-divide parametric noise)
 *
 * Note: EX-slot names are positional only. EX-1/EX-3 are EN-class (neutral commercial),
 * EX-4 is EP-class (Jacobin scores strongly positive for editorial HR advocacy).
 */
export const LIGHT_CALIBRATION_SET: CalibrationUrl[] = [
  { slot: 'EP-1', url: 'https://www.amnesty.org/en/what-we-do/', expectedClass: 'EP', expectedMeanMin: 0.75, expectedMeanMax: 1.00, label: 'Amnesty International' },
  { slot: 'EP-2', url: 'https://www.eff.org/deeplinks', expectedClass: 'EP', expectedMeanMin: 0.60, expectedMeanMax: 0.95, label: 'EFF Deeplinks' },
  { slot: 'EP-3', url: 'https://www.hrw.org', expectedClass: 'EP', expectedMeanMin: 0.70, expectedMeanMax: 0.95, label: 'Human Rights Watch' },
  { slot: 'EP-4', url: 'https://www.propublica.org', expectedClass: 'EP', expectedMeanMin: 0.45, expectedMeanMax: 0.75, label: 'ProPublica' },
  { slot: 'EP-5', url: 'https://archive.org', expectedClass: 'EP', expectedMeanMin: 0.10, expectedMeanMax: 0.90, label: 'Internet Archive' },
  { slot: 'EN-1', url: 'https://www.weather.gov', expectedClass: 'EN', expectedMeanMin: -0.05, expectedMeanMax: 0.20, label: 'Weather.gov' },
  { slot: 'EN-2', url: 'https://www.timeanddate.com', expectedClass: 'EN', expectedMeanMin: -0.08, expectedMeanMax: 0.15, label: 'Time and Date' },
  { slot: 'EN-3', url: 'https://www.xe.com', expectedClass: 'EN', expectedMeanMin: -0.05, expectedMeanMax: 0.20, label: 'XE.com' },
  { slot: 'EN-4', url: 'https://en.wikipedia.org/wiki/Oxygen', expectedClass: 'EN', expectedMeanMin: 0.00, expectedMeanMax: 0.10, label: 'Wikipedia (Oxygen)' },
  { slot: 'EN-5', url: 'https://www.merriam-webster.com', expectedClass: 'EN', expectedMeanMin: -0.05, expectedMeanMax: 0.10, label: 'Merriam-Webster' },
  { slot: 'EX-1', url: 'https://www.shopify.com', expectedClass: 'EN', expectedMeanMin: -0.10, expectedMeanMax: 0.25, label: 'Shopify' },
  { slot: 'EX-2', url: 'https://www.presstv.ir', expectedClass: 'EX', expectedMeanMin: -0.95, expectedMeanMax: -0.20, label: 'PressTV' },
  { slot: 'EX-3', url: 'https://pypi.org', expectedClass: 'EN', expectedMeanMin: -0.10, expectedMeanMax: 0.15, label: 'PyPI' },
  { slot: 'EX-4', url: 'https://jacobin.com', expectedClass: 'EP', expectedMeanMin: 0.35, expectedMeanMax: 0.90, label: 'Jacobin' },
  { slot: 'EX-5', url: 'https://www.globaltimes.cn', expectedClass: 'EX', expectedMeanMin: -0.80, expectedMeanMax: -0.10, label: 'Global Times' },
];

/**
 * Drift thresholds for the light prompt model (editorial-only, light-1.4+).
 * Wider than full-model thresholds — editorial-only scoring has more run-to-run variance.
 */
export const LIGHT_DRIFT_THRESHOLDS = {
  perUrl: { warning: 0.15, halt: 0.25 },
  classMean: {
    EP_min: 0.40,
    EN_max: 0.20,
    EX_max: -0.10,
  },
  pairs: {
    EP1_EP3: 0.15,  // amnesty vs hrw (both high-advocacy NGOs)
    EX2_EX5: 0.70,  // presstv vs globaltimes — fundamentally different editorial styles; presstv aggressively negative, globaltimes neutral-toned; observed delta ~0.58
    EX1_EX3: 0.25,  // shopify vs pypi (neutral commercial; variance expected)
  },
  classOrdering: true,
};

export interface CalibrationResult {
  slot: string;
  url: string;
  label: string;
  expectedClass: string;
  expectedMeanMin: number;
  expectedMeanMax: number;
  actualMean: number | null;
  inRange: boolean;
  drift: number | null;
  status: 'pass' | 'fail' | 'warn' | 'skip';
}

export interface CalibrationSummary {
  results: CalibrationResult[];
  passed: number;
  failed: number;
  warned: number;
  skipped: number;
  status: 'pass' | 'fail' | 'warn';
  classOrderingOk: boolean;
  pairChecks: { pair: string; delta: number; threshold: number; ok: boolean }[];
}

/**
 * Compare actual scores against a calibration set.
 * `scores` is a map from URL → actual weighted mean (null if not evaluated).
 * Defaults to the full-model CALIBRATION_SET and DRIFT_THRESHOLDS;
 * pass LIGHT_CALIBRATION_SET + LIGHT_DRIFT_THRESHOLDS for light prompt evaluation.
 */
export function runCalibrationCheck(
  scores: Map<string, number | null>,
  calSet: CalibrationUrl[] = CALIBRATION_SET,
  thresholds = DRIFT_THRESHOLDS,
): CalibrationSummary {
  const results: CalibrationResult[] = [];

  for (const cal of calSet) {
    const actual = scores.get(cal.url) ?? null;
    if (actual === null) {
      results.push({
        slot: cal.slot, url: cal.url, label: cal.label,
        expectedClass: cal.expectedClass,
        expectedMeanMin: cal.expectedMeanMin, expectedMeanMax: cal.expectedMeanMax,
        actualMean: null, inRange: false, drift: null, status: 'skip',
      });
      continue;
    }

    const midpoint = (cal.expectedMeanMin + cal.expectedMeanMax) / 2;
    const drift = actual - midpoint;
    const inRange = actual >= cal.expectedMeanMin && actual <= cal.expectedMeanMax;
    const absDrift = Math.abs(drift);

    let status: 'pass' | 'fail' | 'warn' = 'pass';
    if (!inRange) {
      status = absDrift > thresholds.perUrl.halt ? 'fail' : 'warn';
    }

    results.push({
      slot: cal.slot, url: cal.url, label: cal.label,
      expectedClass: cal.expectedClass,
      expectedMeanMin: cal.expectedMeanMin, expectedMeanMax: cal.expectedMeanMax,
      actualMean: actual, inRange, drift, status,
    });
  }

  // Class ordering check
  const classMeans = new Map<string, number[]>();
  for (const r of results) {
    if (r.actualMean !== null) {
      const arr = classMeans.get(r.expectedClass) || [];
      arr.push(r.actualMean);
      classMeans.set(r.expectedClass, arr);
    }
  }
  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const epMean = avg(classMeans.get('EP') || []);
  const enMean = avg(classMeans.get('EN') || []);
  const exMean = avg(classMeans.get('EX') || []);
  const classOrderingOk = (epMean === null || enMean === null || epMean > enMean)
    && (enMean === null || exMean === null || enMean > exMean);

  // Pair consistency checks
  const scoreBySlot = new Map<string, number>();
  for (const r of results) {
    if (r.actualMean !== null) scoreBySlot.set(r.slot, r.actualMean);
  }
  const pairChecks: CalibrationSummary['pairChecks'] = [];
  const checkPair = (a: string, b: string, threshold: number) => {
    const va = scoreBySlot.get(a);
    const vb = scoreBySlot.get(b);
    if (va !== undefined && vb !== undefined) {
      const delta = Math.abs(va - vb);
      pairChecks.push({ pair: `${a}/${b}`, delta, threshold, ok: delta <= threshold });
    }
  };
  checkPair('EP-1', 'EP-3', thresholds.pairs.EP1_EP3);
  checkPair('EX-2', 'EX-5', thresholds.pairs.EX2_EX5);
  checkPair('EX-1', 'EX-3', thresholds.pairs.EX1_EX3);

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warned = results.filter(r => r.status === 'warn').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  const pairsFailed = pairChecks.some(p => !p.ok);
  let status: 'pass' | 'fail' | 'warn' = 'pass';
  if (failed > 0 || !classOrderingOk) status = 'fail';
  else if (warned > 0 || pairsFailed) status = 'warn';

  return { results, passed, failed, warned, skipped, status, classOrderingOk, pairChecks };
}
