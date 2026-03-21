/**
 * Озвучка: явные теги от модели (любые языки по ISO), иначе fallback по алфавиту.
 * Поддерживаемые открывающие теги: <l pt>...</l>, <l lang="pt">...</l>, регистр </l> любой.
 */

export interface TtsSegment {
  text: string;
  apiLanguage: string;
}

/** Парные теги: <l pt>, <lpt>, <l lang="pt"> — закрытие </l> в любом регистре */
const PAIRED_TAG_RE =
  /<l\s*(?:lang\s*=\s*["']?([a-z]{2})(?:-[a-z]{2})?["']?\s*|([a-z]{2})\s*)>([\s\S]*?)<\/\s*l\s*>/gi;

function hasAnyTtsMarkup(text: string): boolean {
  // Не использовать просто /<l/i — совпадёт с «line» и т.п.
  return (
    /<\s*l\s*(?:lang\s*=|[a-z]{2}\s*>)/i.test(text) ||
    /<\/\s*l\s*>/i.test(text)
  );
}

/**
 * Текст в чате: убрать служебную разметку (несколько проходов + хвосты).
 */
export function stripTtsMarkupForDisplay(text: string): string {
  if (!text) return '';
  let s = text;
  // Парные теги, пока что-то меняется
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(PAIRED_TAG_RE, (_m, g1: string | undefined, g2: string | undefined, inner: string) => inner);
  }
  // Обломки без закрытия / лишние закрывающие
  s = s.replace(
    /<l\s*(?:lang\s*=\s*["']?[a-z]{2}(?:-[a-z]{2})?["']?\s*|[a-z]{2}\s*)>/gi,
    ''
  );
  s = s.replace(/<\/\s*l\s*>/gi, '');
  s = s.replace(/<\s*l\s*>/gi, '');
  return s.trim();
}

function cleanForTts(text: string): string {
  return text
    .replace(/[,;:\-–—]/g, '\n')
    .replace(/[.!?…]/g, '\n\n')
    .replace(/['"()\[\]]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isCyrillicLetter(ch: string): boolean {
  return /[\u0400-\u04FF]/.test(ch);
}

function isLatinLetter(ch: string): boolean {
  return /[A-Za-z\u00C0-\u024F]/.test(ch);
}

function parseScriptFallbackSegments(text: string, targetLang: 'en' | 'pt'): TtsSegment[] {
  const cleanedInput = stripTtsMarkupForDisplay(text);
  if (!cleanedInput?.trim()) return [];

  const latinApi = targetLang;
  const segments: TtsSegment[] = [];
  let current = '';
  let isCyrillic: boolean | null = null;

  const flush = () => {
    const cleaned = cleanForTts(current);
    if (cleaned) {
      segments.push({
        text: cleaned,
        apiLanguage: isCyrillic ? 'ru' : latinApi,
      });
    }
    current = '';
  };

  for (let i = 0; i < cleanedInput.length; i++) {
    const ch = cleanedInput[i];
    const cyr = isCyrillicLetter(ch);
    const lat = isLatinLetter(ch);

    if (cyr) {
      if (isCyrillic === false) {
        flush();
        isCyrillic = true;
      } else if (isCyrillic === null) isCyrillic = true;
      current += ch;
    } else if (lat) {
      if (isCyrillic === true) {
        flush();
        isCyrillic = false;
      } else if (isCyrillic === null) isCyrillic = false;
      current += ch;
    } else {
      current += ch;
    }
  }
  flush();

  if (segments.length === 0) {
    const cleaned = cleanForTts(cleanedInput);
    if (!cleaned) return [];
    return [{ text: cleaned, apiLanguage: latinApi }];
  }
  return segments;
}

function normalizeTagLang(code: string, targetLang: 'en' | 'pt'): string {
  const c = code.toLowerCase();
  if (/^[a-z]{2}$/.test(c)) return c;
  return targetLang;
}

function parseTaggedSegments(text: string, targetLang: 'en' | 'pt'): TtsSegment[] {
  const segments: TtsSegment[] = [];
  let lastIndex = 0;
  const re = new RegExp(PAIRED_TAG_RE.source, PAIRED_TAG_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(lastIndex, m.index);
    if (before.trim()) {
      segments.push(...parseScriptFallbackSegments(before, targetLang));
    }
    const langCode = normalizeTagLang((m[1] || m[2] || targetLang) as string, targetLang);
    const inner = (m[3] ?? '').trim();
    if (inner) {
      const cleaned = cleanForTts(inner);
      if (cleaned) {
        segments.push({ text: cleaned, apiLanguage: langCode });
      }
    }
    lastIndex = m.index + m[0].length;
  }
  const after = text.slice(lastIndex);
  if (after.trim()) {
    segments.push(...parseScriptFallbackSegments(after, targetLang));
  }
  return segments;
}

export function getTtsSegments(text: string, targetLang: 'en' | 'pt'): TtsSegment[] {
  if (!text?.trim()) return [];
  if (hasAnyTtsMarkup(text)) {
    return parseTaggedSegments(text, targetLang);
  }
  return parseScriptFallbackSegments(text, targetLang);
}
