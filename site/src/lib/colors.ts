/** Map a score [-1, +1] to a hex color on a diverging red-gray-green scale */
export function scoreToColor(score: number | null): string {
  if (score === null) return '#2a2a35'; // ND gray

  const clamped = Math.max(-1, Math.min(1, score));

  if (clamped < 0) {
    // Red channel: interpolate from gray (#555) to red (#dc2626)
    const t = Math.abs(clamped);
    const r = Math.round(0x55 + (0xdc - 0x55) * t);
    const g = Math.round(0x55 + (0x26 - 0x55) * t);
    const b = Math.round(0x55 + (0x26 - 0x55) * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Green channel: interpolate from gray (#555) to green (#16a34a)
    const t = clamped;
    const r = Math.round(0x55 + (0x16 - 0x55) * t);
    const g = Math.round(0x55 + (0xa3 - 0x55) * t);
    const b = Math.round(0x55 + (0x4a - 0x55) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

/** Get a text color (white or black) with enough contrast for a given score */
export function scoreTextColor(score: number | null): string {
  return '#e5e5e5';
}

/** Get classification badge color */
export function classificationColor(classification: string): string {
  const lower = classification.toLowerCase();
  if (lower.includes('strong positive')) return '#16a34a';
  if (lower.includes('moderate positive')) return '#22c55e';
  if (lower.includes('mild positive')) return '#86efac';
  if (lower.includes('neutral')) return '#6b7280';
  if (lower.includes('mild negative')) return '#fca5a5';
  if (lower.includes('moderate negative')) return '#ef4444';
  if (lower.includes('strong negative')) return '#dc2626';
  return '#6b7280';
}

/** Get classification badge text color */
export function classificationTextColor(classification: string): string {
  const lower = classification.toLowerCase();
  if (lower.includes('mild positive') || lower.includes('mild negative')) return '#1a1a25';
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
  if (setl === null) return '#2a2a35';
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
  if (hotl === null) return '#2a2a35';
  return scoreToColor(-hotl);
}

/** DCP modifier color */
export function modifierColor(mod: number | null): string {
  if (mod === null) return '#3a3a45';
  if (mod > 0.05) return '#22c55e';
  if (mod > 0) return '#86efac';
  if (mod === 0) return '#6b7280';
  if (mod > -0.05) return '#fca5a5';
  return '#ef4444';
}
