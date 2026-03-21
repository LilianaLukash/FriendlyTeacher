import { getDb } from './init';
import type { PhraseState } from './schema';

const LEARNING_SUCCESS_THRESHOLD = 3;
const DISTINCT_CONTEXTS_THRESHOLD = 3;

export interface PhraseRow {
  id: number;
  phrase_text: string;
  translation: string | null;
  state: PhraseState;
  success_count: number;
  distinct_contexts_count: number;
  last_success_at: string | null;
  next_review_at: string | null;
  created_at: string;
}

/**
 * Record one successful repetition of a phrase in a given context.
 * Updates phrase state to 'learned' when we have 3 successes in 3 different contexts.
 */
export async function recordPhraseRepetition(
  phraseId: number,
  recognizedText: string,
  contextHint: string
): Promise<void> {
  const database = await getDb();

  await database.runAsync(
    `INSERT INTO phrase_repetitions (phrase_id, recognized_text, context_hint) VALUES (?, ?, ?)`,
    [phraseId, recognizedText, contextHint]
  );

  const rows = await database.getAllAsync<{ success_count: number; distinct_contexts: number }>(
    `SELECT 
       COUNT(*) AS success_count,
       COUNT(DISTINCT context_hint) AS distinct_contexts
     FROM phrase_repetitions WHERE phrase_id = ?`,
    [phraseId]
  );
  const { success_count, distinct_contexts } = rows[0] ?? { success_count: 0, distinct_contexts: 0 };

  const now = new Date().toISOString();
  let newState: PhraseState = 'learning';
  let nextReviewAt: string | null = null;

  if (success_count >= LEARNING_SUCCESS_THRESHOLD && distinct_contexts >= DISTINCT_CONTEXTS_THRESHOLD) {
    newState = 'learned';
    const reviewDate = new Date();
    reviewDate.setDate(reviewDate.getDate() + 7);
    nextReviewAt = reviewDate.toISOString();
  }

  await database.runAsync(
    `UPDATE phrases SET 
       state = ?, 
       success_count = ?, 
       distinct_contexts_count = ?, 
       last_success_at = ?, 
       next_review_at = COALESCE(?, next_review_at),
       updated_at = ? 
     WHERE id = ?`,
    [newState, success_count, distinct_contexts, now, nextReviewAt, now, phraseId]
  );
}

/**
 * Get phrases that are in learning or review state (for session: match user speech and record repetitions).
 */
export async function getPhrasesForSession(): Promise<PhraseRow[]> {
  const database = await getDb();
  return database.getAllAsync<PhraseRow>(
    `SELECT id, phrase_text, translation, state, success_count, distinct_contexts_count,
            last_success_at, next_review_at, created_at
     FROM phrases WHERE state IN ('learning', 'review') ORDER BY updated_at DESC`
  );
}

/**
 * Get all phrases for "My Phrases" screen (read, listen, repeat).
 */
export async function getAllPhrases(): Promise<PhraseRow[]> {
  const database = await getDb();
  return database.getAllAsync<PhraseRow>(
    `SELECT id, phrase_text, translation, state, success_count, distinct_contexts_count, 
            last_success_at, next_review_at, created_at 
     FROM phrases ORDER BY updated_at DESC`
  );
}

/**
 * Insert or get existing phrase; returns phrase id.
 * Translation (e.g. Russian) is optional; can be set when Sam introduces the phrase.
 */
export async function ensurePhrase(phraseText: string, translation?: string | null): Promise<number> {
  const database = await getDb();
  const existing = await database.getFirstAsync<{ id: number }>(
    `SELECT id FROM phrases WHERE phrase_text = ?`,
    [phraseText]
  );
  if (existing) return existing.id;
  const result = await database.runAsync(
    `INSERT INTO phrases (phrase_text, translation) VALUES (?, ?)`,
    [phraseText, translation ?? null]
  );
  return result.lastInsertRowId;
}
