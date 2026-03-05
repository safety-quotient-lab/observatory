// SPDX-License-Identifier: Apache-2.0
/**
 * Statistical utilities for confidence interval computation.
 * t-critical values verified via Wolfram Alpha (2026-03-05, 9 queries).
 */

/**
 * Student's t-distribution critical values for 95% CI (two-tailed, α=0.025 each tail).
 * Source: Wolfram Alpha InverseCDF[StudentTDistribution[df], 0.975].
 * Verified values for df = 1..120; linear interpolation between anchors.
 */
const T_CRITICAL_TABLE: [number, number][] = [
  // [df, t_0.975] — Wolfram-verified anchor points
  [1, 12.7062],
  [2,  4.3027],
  [3,  3.1824],
  [4,  2.7764],
  [5,  2.5706],
  [6,  2.4469],
  [7,  2.3646],
  [8,  2.3060],
  [9,  2.2622],
  [10, 2.2281],
  [15, 2.1314],
  [20, 2.0860],
  [25, 2.0595],
  [30, 2.0423],
  [40, 2.0211],
  [50, 2.0086],
  [60, 2.0003],
  [80, 1.9901],
  [100, 1.9840],
  [120, 1.9799],
];

/** Look up t-critical value for given degrees of freedom via interpolation. */
export function tCritical(df: number): number {
  if (df < 1) return 12.7062; // degenerate
  if (df >= 120) return 1.960; // z-approximation

  // Find bracketing anchors
  for (let i = 0; i < T_CRITICAL_TABLE.length - 1; i++) {
    const [df0, t0] = T_CRITICAL_TABLE[i];
    const [df1, t1] = T_CRITICAL_TABLE[i + 1];
    if (df >= df0 && df <= df1) {
      if (df === df0) return t0;
      // Linear interpolation
      const frac = (df - df0) / (df1 - df0);
      return t0 + frac * (t1 - t0);
    }
  }
  return 1.960;
}

export interface CI {
  lower: number;
  upper: number;
  margin: number;
}

/**
 * Wilson score interval for a binomial proportion.
 * Superior to Wald (normal) interval for small n or extreme p.
 * Formula verified via Wolfram Alpha.
 *
 * @param successes Number of successes (k)
 * @param n         Sample size
 * @param z         z-critical value (default 1.96 for 95% CI)
 * @returns CI with lower/upper as proportions [0,1] and margin as percentage points
 */
export function wilsonCI(successes: number, n: number, z = 1.96): CI {
  if (n <= 0) return { lower: 0, upper: 0, margin: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const spread = z * Math.sqrt((p * (1 - p) / n) + (z2 / (4 * n * n))) / denom;
  const lower = Math.max(0, center - spread);
  const upper = Math.min(1, center + spread);
  // margin in percentage points (for display as ±X%)
  const margin = spread * 100;
  return { lower, upper, margin };
}

/**
 * Confidence interval for a mean using t-distribution.
 *
 * @param mean   Sample mean
 * @param stdDev Sample standard deviation
 * @param n      Sample size
 * @returns CI with lower/upper in original units and margin
 */
export function meanCI(mean: number, stdDev: number, n: number): CI {
  if (n <= 1) return { lower: mean, upper: mean, margin: 0 };
  const t = tCritical(n - 1);
  const margin = t * stdDev / Math.sqrt(n);
  return { lower: mean - margin, upper: mean + margin, margin };
}
