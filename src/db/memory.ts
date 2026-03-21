import { getDb } from './init';

export interface TriggerRow {
  id: number;
  text: string;
  created_at: string;
}

export interface GoalRow {
  id: number;
  text: string;
  created_at: string;
}

export interface RecentEventRow {
  id: number;
  emotion: string;
  context: string;
  created_at: string;
}

export interface ConversationMemory {
  json: unknown;
  summary: string;
  updated_at: string;
}

export async function getTriggers(): Promise<TriggerRow[]> {
  const db = await getDb();
  return db.getAllAsync<TriggerRow>('SELECT id, text, created_at FROM triggers ORDER BY created_at DESC LIMIT 20');
}

export async function getGoals(): Promise<GoalRow[]> {
  const db = await getDb();
  return db.getAllAsync<GoalRow>('SELECT id, text, created_at FROM goals ORDER BY created_at DESC LIMIT 10');
}

export async function getRecentEvents(): Promise<RecentEventRow[]> {
  const db = await getDb();
  return db.getAllAsync<RecentEventRow>(
    'SELECT id, emotion, context, created_at FROM recent_events ORDER BY created_at DESC LIMIT 10'
  );
}

export async function getConversationMemory(): Promise<ConversationMemory | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ConversationMemory>(
    'SELECT json, summary, updated_at FROM memory WHERE id = 1'
  );
  return row ?? null;
}

export async function saveConversationMemory(memory: { json: unknown; summary: string }): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const jsonText = JSON.stringify(memory.json ?? {});
  await db.runAsync(
    `INSERT INTO memory (id, json, summary, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, summary = excluded.summary, updated_at = excluded.updated_at`,
    [jsonText, memory.summary, now]
  );
}
