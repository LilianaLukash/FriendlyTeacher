import * as SQLite from 'expo-sqlite';
import { DB_NAME, CREATE_TABLES } from './schema';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(CREATE_TABLES);
  try {
    await db.runAsync('ALTER TABLE phrases ADD COLUMN translation TEXT');
  } catch {
    // Column already exists
  }
  // Profile: trial/code token limits + coach mode
  for (const col of [
    'ALTER TABLE profile ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE profile ADD COLUMN code_expires_at TEXT',
    'ALTER TABLE profile ADD COLUMN tokens_used_at_code_entry INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE profile ADD COLUMN coach_mode INTEGER NOT NULL DEFAULT 3',
  ]) {
    try {
      await db.runAsync(col);
    } catch {
      // Column already exists
    }
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
}
