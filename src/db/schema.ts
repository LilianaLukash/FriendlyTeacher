/**
 * SQLite schema for Friendly Sam.
 * All personal data stays on device.
 */

export const DB_NAME = 'friendlysam.db';

export type PhraseState = 'learning' | 'learned' | 'review';

export const CREATE_TABLES = `
-- Single row: user profile (from onboarding + conversation)
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT,
  city TEXT,
  partner TEXT,
  children_json TEXT,
  native_lang TEXT DEFAULT 'ru',
  target_lang TEXT NOT NULL DEFAULT 'en',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  code_expires_at TEXT,
  tokens_used_at_code_entry INTEGER NOT NULL DEFAULT 0,
  coach_mode INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Triggers / stress triggers (collected in conversation)
CREATE TABLE IF NOT EXISTS triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Goals (collected in conversation)
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Recent emotional events (light CBT context)
CREATE TABLE IF NOT EXISTS recent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emotion TEXT NOT NULL,
  context TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Flexible psychological memory (JSON + summary), single row
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT,
  summary TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phrases: learning unit (phrase / collocation); translation = native language (ru)
CREATE TABLE IF NOT EXISTS phrases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phrase_text TEXT NOT NULL UNIQUE,
  translation TEXT,
  state TEXT NOT NULL DEFAULT 'learning' CHECK (state IN ('learning', 'learned', 'review')),
  success_count INTEGER NOT NULL DEFAULT 0,
  distinct_contexts_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  next_review_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Each successful repetition: phrase + context hint (for "3 different contexts" rule)
CREATE TABLE IF NOT EXISTS phrase_repetitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phrase_id INTEGER NOT NULL REFERENCES phrases(id) ON DELETE CASCADE,
  recognized_text TEXT NOT NULL,
  context_hint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_phrase_repetitions_phrase_id ON phrase_repetitions(phrase_id);
CREATE INDEX IF NOT EXISTS idx_phrases_state ON phrases(state);
CREATE INDEX IF NOT EXISTS idx_phrases_next_review ON phrases(next_review_at);
`;
