// SPDX-License-Identifier: Apache-2.0
/** Convert HSL (h: 0-360, s: 0-1, l: 0-1) to RGB string */
function hslToRgb(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return `rgb(${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)})`;
}

/** Map a score [-1, +1] to a color via HSL interpolation for clean transitions.
 *  -1.0 = red (hue 0°), 0.0 = gray (desaturated), +1.0 = green (hue 142°).
 *  Scores near zero desaturate smoothly toward gray; colors become vivid as magnitude increases.
 *  Interpolates through HSL so mid-tones stay vibrant instead of going muddy brown.
 *  @param lightMode — when true, uses lighter-bg lightness target (~4.5:1 on OkSolar cream).
 *                     Dark mode default is calibrated for #002d38 bg; light for #fdf6e3. */
export function scoreToColor(score: number | null | undefined, lightMode = false): string {
  if (score == null) return lightMode ? '#374151' : '#4b5563'; // ND gray

  const clamped = Math.max(-1, Math.min(1, score));
  const abs = Math.abs(clamped);

  // Piecewise-linear hue mapping: -1→0°, 0→40°, +1→142°
  // (hue is still interpolated but becomes irrelevant at zero saturation)
  let hue: number;
  if (clamped < 0) {
    // red (0°) to amber-midpoint (40°)
    hue = 40 * (1 + clamped); // clamped=-1→0°, clamped=0→40°
  } else {
    // amber-midpoint (40°) to green (142°)
    hue = 40 + 102 * clamped; // clamped=0→40°, clamped=1→142°
  }

  // Saturation: fully desaturated at zero, ramps up with magnitude.
  // Near-zero scores (±0.05) stay grayish; full color by ±0.4.
  const sat = Math.min(0.9, abs * 2.0) * (0.75 + 0.15 * abs);

  // Lightness: calibrated per background.
  // Dark mode (#002d38): 0.58→0.52 — neutral gray gives ~6.3:1 on dark bg.
  // Light mode (#fdf6e3): 0.43→0.37 — neutral gray gives ~4.6:1 on cream bg.
  const baseLit = lightMode ? 0.43 : 0.58;
  const lit = baseLit - 0.06 * abs;

  return hslToRgb(hue, sat, lit);
}

/** Map a Pearson r [-1, +1] to a color for correlation display.
 *  Unlike scoreToColor, zero = neutral gray (no hue), not amber.
 *  -1.0 = red (anti-correlated), 0.0 = gray (no relationship), +1.0 = green (correlated). */
export function correlationToColor(r: number | null | undefined, lightMode = false): string {
  if (r == null) return lightMode ? '#374151' : '#4b5563';
  const clamped = Math.max(-1, Math.min(1, r));
  const abs = Math.abs(clamped);
  // Hue: negative → red (0°), positive → green (142°)
  const hue = clamped < 0 ? 0 : 142;
  // Saturation: zero at r=0, slow ramp — stays gray until |r| > 0.3
  const sat = abs < 0.1 ? 0 : Math.min(0.85, (abs - 0.1) * 1.2);
  // Lightness: dark bg 0.58→0.52, light bg 0.43→0.37 (same calibration as scoreToColor)
  const baseLit = lightMode ? 0.43 : 0.58;
  const lit = baseLit - 0.06 * abs;
  return hslToRgb(hue, sat, lit);
}

/** Get classification badge color (derived from scoreToColor scale) */
export function classificationColor(classification: string): string {
  const lower = classification.toLowerCase();
  if (lower.includes('strong positive')) return scoreToColor(0.9);
  if (lower.includes('moderate positive')) return scoreToColor(0.55);
  if (lower.includes('mild positive')) return scoreToColor(0.25);
  if (lower.includes('neutral')) return scoreToColor(0);
  if (lower.includes('mild negative')) return scoreToColor(-0.25);
  if (lower.includes('moderate negative')) return scoreToColor(-0.55);
  if (lower.includes('strong negative')) return scoreToColor(-0.9);
  return '#4b5563';
}

/** Get classification badge text color */
export function classificationTextColor(classification: string): string {
  return '#ffffff';
}

/** Format a score for display */
export function formatScore(score: number | null | undefined): string {
  if (score == null) return 'ND';
  const sign = score > 0 ? '+' : '';
  return `${sign}${score.toFixed(2)}`;
}

/** Evidence badge color — OkSolar teal brightness ramp (distinct from score red→green) */
export function evidenceColor(evidence: string | null, lightMode = false): string {
  if (lightMode) {
    switch (evidence) {
      case 'H': return '#1a7d77'; // darker cyan — contrast ~4.9:1 on cream
      case 'M': return '#526870'; // darker gray  — contrast ~4.6:1 on cream
      case 'L': return '#4a5c61'; // darker muted — contrast ~5.1:1 on cream
      default:  return '#2d5f6e'; // darker border — contrast ~4.8:1 on cream
    }
  }
  switch (evidence) {
    case 'H': return '#259d94'; // cyan (bright)
    case 'M': return '#98a8a8'; // fg-primary (neutral)
    case 'L': return '#5b7279'; // fg-secondary (muted)
    default:  return '#1a5568'; // border (dim)
  }
}

/** Directionality badge color */
export function directionalityColor(d: string, lightMode = false): string {
  if (lightMode) {
    switch (d) {
      case 'A': return '#4338ca'; // Advocacy - indigo-700
      case 'P': return '#0891b2'; // Practice - cyan-600
      case 'F': return '#7c3aed'; // Framing - violet-600
      case 'C': return '#c2410c'; // Content - orange-700
      default: return '#374151';
    }
  }
  switch (d) {
    case 'A': return '#818cf8'; // Advocacy - indigo
    case 'P': return '#22d3ee'; // Practice - cyan
    case 'F': return '#a78bfa'; // Framing - violet
    case 'C': return '#fb923c'; // Content - orange
    default: return '#6b7280';
  }
}

/** Compute SETL (Structural-Editorial Tension Level) via geometric mean of gap and signal strength.
 *  sign(E-S) * sqrt(|E-S| * max(|E|, |S|)) — rewards both large gaps AND strong signals. */
export function computeSetl(structural: number | null | undefined, editorial: number | null | undefined): number | null {
  if (structural == null || editorial == null) return null;
  const diff = editorial - structural;
  const strength = Math.max(Math.abs(editorial), Math.abs(structural));
  if (strength === 0 && diff === 0) return null;
  const magnitude = Math.sqrt(Math.abs(diff) * strength);
  const raw = diff >= 0 ? magnitude : -magnitude;
  return Math.max(-1.0, Math.min(1.0, raw));
}

/** Format SETL value for display */
export function formatSetl(setl: number | null | undefined): string {
  if (setl == null) return 'ND';
  const sign = setl > 0 ? '+' : '';
  return `${sign}${setl.toFixed(2)}`;
}

/** Map SETL [-1, +1] to a color: green for positive, red for negative */
export function setlToColor(setl: number | null | undefined): string {
  if (setl == null) return '#6b7280';
  return scoreToColor(setl);
}


/** Compute evidence-weighted confidence using EVIDENCE_WEIGHTS_CONFIDENCE scale */
export function computeConfidence(
  evidenceH: number | null | undefined, evidenceM: number | null | undefined, evidenceL: number | null | undefined, ndCount: number | null | undefined
): number | null {
  if (evidenceH == null || evidenceM == null || evidenceL == null || ndCount == null) return null;
  const total = evidenceH + evidenceM + evidenceL + ndCount;
  if (total === 0) return null;
  // Weights: H=1.0, M=0.6, L=0.2 (from EVIDENCE_WEIGHTS_CONFIDENCE in compute-aggregates.ts)
  return (evidenceH * 1.0 + evidenceM * 0.6 + evidenceL * 0.2) / total;
}

/** Map confidence (0–1) to a color: gray (0) → cyan (1.0)
 *  Uses fg-secondary → color-cyan interpolation (distinct from score red→green) */
export function confidenceToColor(confidence: number | null | undefined): string {
  if (confidence == null) return '#4b5563';
  const c = Math.max(0, Math.min(1, confidence));

  // Gray → Cyan: fg-secondary (#5b7279) at 0 → color-cyan (#259d94) at 1
  // Both hue and luminance vary for accessibility
  const hue = 195 - 21 * c;         // 195° → 174°
  const sat = 0.13 + 0.47 * c;      // 0.13 → 0.60
  const lit = 0.41 - 0.03 * c;      // 0.41 → 0.38

  return hslToRgb(hue, sat, lit);
}

/** Format confidence for display */
export function formatConfidence(confidence: number | null | undefined): string {
  if (confidence == null) return 'ND';
  return Math.round(confidence * 100) + '%';
}

/** DCP modifier color */
export function modifierColor(mod: number | null | undefined): string {
  if (mod == null) return '#1a5568';
  // Map modifier (typically small, e.g. -0.1 to +0.1) to score scale
  const scaled = Math.max(-1, Math.min(1, mod * 10));
  return scoreToColor(scaled);
}

/** Content gate category color */
export function gateToColor(category: string): string {
  switch (category) {
    case 'paywall': return '#dc2626';
    case 'bot_protection': return '#dc2626';
    case 'captcha': return '#eab308';
    case 'login_wall': return '#a78bfa';
    case 'cookie_wall': return '#60a5fa';
    case 'geo_restriction': return '#22d3ee';
    case 'rate_limited': return '#f97316';
    case 'error_page': return '#5b7279';
    case 'age_gate': return '#e879f9';
    case 'app_gate': return '#34d399';
    case 'redirect_or_js_required': return '#5b7279';
    default: return '#5b7279';
  }
}

/** Fair Witness ratio color: maps 0–1 to purple(0) → green(1) */
export function fwRatioColor(ratio: number | null | undefined): string {
  if (ratio == null) return '#4b5563';
  const r = Math.max(0, Math.min(1, ratio));
  // Low ratio (more inference) = purple, high ratio (more observable) = green
  // Shift hue toward 280 (purple) for low r, 142 (green) for high r
  const adjustedHue = r < 0.5 ? 280 - (280 - 142) * (r / 0.5) : 142;
  const sat = 0.7;
  const lit = 0.45;
  return hslToRgb(adjustedHue, sat, lit);
}

/** Format Fair Witness ratio for display */
export function formatFwRatio(ratio: number | null | undefined): string {
  if (ratio == null) return 'ND';
  return Math.round(ratio * 100) + '%';
}
