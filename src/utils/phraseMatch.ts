/**
 * Check if recognized speech approximately matches target phrase.
 * Uses Levenshtein distance; one repetition is counted when match is "close enough".
 */

/**
 * Levenshtein (edit) distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= lenA; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= lenB; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[lenA][lenB];
}

/**
 * Normalize string for comparison: trim, collapse spaces, optional lowercase.
 */
function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface MatchOptions {
  /** Max allowed edit distance (default: derived from length) */
  maxDistance?: number;
  /** If true, use ratio (distance / maxLen) instead of absolute distance (default: true) */
  useRatio?: boolean;
  /** Max ratio 0..1 (default 0.25 = 25% of chars can differ) */
  maxRatio?: number;
}

const DEFAULT_OPTIONS: Required<MatchOptions> = {
  useRatio: true,
  maxRatio: 0.25,
  maxDistance: 0,
};

/**
 * Returns true if recognized text is close enough to target phrase to count as one repetition.
 */
export function phraseMatches(
  recognized: string,
  targetPhrase: string,
  options: MatchOptions = {}
): boolean {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const nRecognized = normalize(recognized);
  const nTarget = normalize(targetPhrase);

  if (nTarget.length === 0) return false;

  const dist = levenshtein(nRecognized, nTarget);
  const maxLen = Math.max(nRecognized.length, nTarget.length);

  if (opts.useRatio) {
    const ratio = maxLen === 0 ? 0 : dist / maxLen;
    return ratio <= opts.maxRatio;
  }

  const allowed = opts.maxDistance > 0 ? opts.maxDistance : Math.ceil(maxLen * opts.maxRatio);
  return dist <= allowed;
}

/**
 * Get edit distance (for logging/debug).
 */
export function getEditDistance(a: string, b: string): number {
  return levenshtein(normalize(a), normalize(b));
}
