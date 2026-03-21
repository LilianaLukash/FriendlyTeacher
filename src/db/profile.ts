import { getDb } from './init';

export interface ProfileRow {
  id: number;
  name: string | null;
  city: string | null;
  partner: string | null;
  children_json: string | null;
  native_lang: string;
  target_lang: string;
  tokens_used: number;
  code_expires_at: string | null;
  tokens_used_at_code_entry: number;
  coach_mode: number;
  created_at: string;
  updated_at: string;
}

export type TargetLang = 'en' | 'pt';

/**
 * Get profile (single row). Returns null if not set.
 */
export async function getProfile(): Promise<ProfileRow | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<ProfileRow>(
    'SELECT * FROM profile WHERE id = 1'
  );
  return row ?? null;
}

/**
 * Create or update profile. Use for onboarding (name, target_lang).
 */
export async function saveProfile(updates: {
  name?: string | null;
  target_lang?: TargetLang;
  city?: string | null;
  partner?: string | null;
  children_json?: string | null;
  coach_mode?: number;
}): Promise<void> {
  const database = await getDb();
  const existing = await database.getFirstAsync<{ id: number }>('SELECT id FROM profile WHERE id = 1');
  const now = new Date().toISOString();

  if (existing) {
    const set: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [now];
    if (updates.name !== undefined) { set.push('name = ?'); values.push(updates.name); }
    if (updates.target_lang !== undefined) { set.push('target_lang = ?'); values.push(updates.target_lang); }
    if (updates.city !== undefined) { set.push('city = ?'); values.push(updates.city); }
    if (updates.partner !== undefined) { set.push('partner = ?'); values.push(updates.partner); }
    if (updates.children_json !== undefined) { set.push('children_json = ?'); values.push(updates.children_json); }
    if (updates.coach_mode !== undefined) { set.push('coach_mode = ?'); values.push(Math.min(7, Math.max(0, Math.round(updates.coach_mode)))); }
    values.push(1);
    await database.runAsync(
      `UPDATE profile SET ${set.join(', ')} WHERE id = ?`,
      values
    );
  } else {
    const cm = updates.coach_mode !== undefined ? Math.min(7, Math.max(0, Math.round(updates.coach_mode))) : 3;
    await database.runAsync(
      `INSERT INTO profile (id, name, target_lang, native_lang, tokens_used, tokens_used_at_code_entry, coach_mode, created_at, updated_at) VALUES (1, ?, ?, 'ru', 0, 0, ?, ?, ?)`,
      [updates.name ?? null, updates.target_lang ?? 'en', cm, now, now]
    );
  }
}

/** Trial limit (first 50k tokens). Code grants this many extra (e.g. 150k). */
export const TRIAL_TOKENS = 50_000;
export const CODE_TOKENS = 150_000;

export type AccessState =
  | { canChat: true; tokensRemaining: number; isTrial: boolean; expiresAt: string | null }
  | { canChat: false; reason: 'trial_over' | 'code_used_up'; tokensRemaining: 0 };

/**
 * Compute whether user can chat (trial or code allowance) and remaining tokens.
 */
export function getAccessState(profile: ProfileRow | null): AccessState {
  if (!profile) {
    return { canChat: true, tokensRemaining: TRIAL_TOKENS, isTrial: true, expiresAt: null };
  }
  const tu = profile.tokens_used ?? 0;
  const hasCode = !!profile.code_expires_at?.trim();
  const atCode = profile.tokens_used_at_code_entry ?? 0;

  if (!hasCode) {
    const remaining = Math.max(0, TRIAL_TOKENS - tu);
    return remaining > 0
      ? { canChat: true, tokensRemaining: remaining, isTrial: true, expiresAt: null }
      : { canChat: false, reason: 'trial_over', tokensRemaining: 0 };
  }

  const codeAllowance = CODE_TOKENS - (tu - atCode);
  if (codeAllowance <= 0) {
    return { canChat: false, reason: 'code_used_up', tokensRemaining: 0 };
  }
  return {
    canChat: true,
    tokensRemaining: codeAllowance,
    isTrial: false,
    expiresAt: profile.code_expires_at,
  };
}

export async function addTokensUsed(tokens: number): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE profile SET tokens_used = tokens_used + ?, updated_at = ? WHERE id = 1',
    [tokens, new Date().toISOString()]
  );
}

export async function setCodeGranted(expiresAt: string): Promise<void> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ tokens_used: number }>('SELECT tokens_used FROM profile WHERE id = 1');
  const tu = row?.tokens_used ?? 0;
  await database.runAsync(
    'UPDATE profile SET code_expires_at = ?, tokens_used_at_code_entry = ?, updated_at = ? WHERE id = 1',
    [expiresAt, tu, new Date().toISOString()]
  );
}
