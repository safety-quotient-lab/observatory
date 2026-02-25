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
 *  -1.0 = red (hue 0°), 0.0 = amber (hue 40°), +1.0 = green (hue 142°).
 *  Interpolates through HSL so mid-tones stay vibrant instead of going muddy brown. */
export function scoreToColor(score: number | null): string {
  if (score === null) return '#4b5563'; // ND gray (gray-600)

  const clamped = Math.max(-1, Math.min(1, score));

  // Piecewise-linear hue mapping: -1→0°, 0→40°, +1→142°
  let hue: number;
  if (clamped < 0) {
    // red (0°) to amber (40°)
    hue = 40 * (1 + clamped); // clamped=-1→0°, clamped=0→40°
  } else {
    // amber (40°) to green (142°)
    hue = 40 + 102 * clamped; // clamped=0→40°, clamped=1→142°
  }

  // Saturation: high throughout, slight dip near zero for a muted amber midpoint
  const sat = 0.75 + 0.15 * Math.abs(clamped);

  // Lightness: brighter at extremes, slightly dimmer at midpoint for depth on dark bg
  const lit = 0.42 + 0.08 * Math.abs(clamped);

  return hslToRgb(hue, sat, lit);
}

/** Get a text color (white or black) with enough contrast for a given score */
export function scoreTextColor(score: number | null): string {
  return '#e5e5e5';
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
export function formatScore(score: number | null): string {
  if (score === null) return 'ND';
  const sign = score > 0 ? '+' : '';
  return `${sign}${score.toFixed(2)}`;
}

/** Evidence badge color */
export function evidenceColor(evidence: string | null): string {
  switch (evidence) {
    case 'H': return '#22c55e';
    case 'M': return '#eab308';
    case 'L': return '#6b7280';
    default: return '#3a3a45';
  }
}

/** Directionality badge color */
export function directionalityColor(d: string): string {
  switch (d) {
    case 'A': return '#818cf8'; // Advocacy - indigo
    case 'P': return '#22d3ee'; // Practice - cyan
    case 'F': return '#a78bfa'; // Framing - violet
    case 'C': return '#fb923c'; // Content - orange
    default: return '#6b7280';
  }
}

/** Compute SETL (Structural-Editorial Tension Level) from S and E channel scores */
export function computeSetl(structural: number | null, editorial: number | null): number | null {
  if (structural === null || editorial === null) return null;
  const diff = editorial - structural;
  const denom = Math.max(Math.abs(structural), Math.abs(editorial), Math.abs(diff));
  if (denom === 0) return null;
  return diff / denom;
}

/** Format SETL value for display */
export function formatSetl(setl: number | null): string {
  if (setl === null) return 'ND';
  const sign = setl > 0 ? '+' : '';
  return `${sign}${setl.toFixed(2)}`;
}

/** Map SETL [-1, +1] to a color: green for positive, red for negative */
export function setlToColor(setl: number | null): string {
  if (setl === null) return '#6b7280';
  return scoreToColor(setl);
}

/** Compute HOTL (Higher Order Tension Level) from HN points and comments */
export function computeHotl(points: number | null, comments: number | null): number | null {
  if (points === null || comments === null) return null;
  const denom = points + comments;
  if (denom === 0) return null;
  return (comments - points) / denom;
}

/** Format HOTL value for display */
export function formatHotl(hotl: number | null): string {
  if (hotl === null) return 'ND';
  const sign = hotl > 0 ? '+' : '';
  return `${sign}${hotl.toFixed(2)}`;
}

/** Map HOTL [-1, +1] to a color: green for negative (low tension = consensus), red for positive (high tension = contentious) */
export function hotlToColor(hotl: number | null): string {
  if (hotl === null) return '#6b7280';
  return scoreToColor(-hotl);
}

/** Compute confidence proxy from signal sections and ND count */
export function computeConfidence(signalSections: number | null, ndCount: number | null): number | null {
  if (signalSections === null || ndCount === null) return null;
  const total = signalSections + ndCount;
  if (total === 0) return null;
  return signalSections / total;
}

/** Map confidence (0–1) to a color: red (0) → amber (0.5) → green (1.0) */
export function confidenceToColor(confidence: number | null): string {
  if (confidence === null) return '#4b5563';
  const c = Math.max(0, Math.min(1, confidence));

  // Piecewise hue: 0→0° (red), 0.5→40° (amber), 1.0→142° (green)
  let hue: number;
  if (c < 0.5) {
    hue = 40 * (c / 0.5); // 0→0°, 0.5→40°
  } else {
    hue = 40 + 102 * ((c - 0.5) / 0.5); // 0.5→40°, 1.0→142°
  }

  const sat = 0.75 + 0.15 * Math.abs(c * 2 - 1);
  const lit = 0.42 + 0.08 * Math.abs(c * 2 - 1);

  return hslToRgb(hue, sat, lit);
}

/** Format confidence for display */
export function formatConfidence(confidence: number | null): string {
  if (confidence === null) return 'ND';
  return Math.round(confidence * 100) + '%';
}

/** DCP modifier color */
export function modifierColor(mod: number | null): string {
  if (mod === null) return '#3a3a45';
  // Map modifier (typically small, e.g. -0.1 to +0.1) to score scale
  const scaled = Math.max(-1, Math.min(1, mod * 10));
  return scoreToColor(scaled);
}
