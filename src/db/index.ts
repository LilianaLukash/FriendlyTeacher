export { getDb, closeDb } from './init';
export {
  DB_NAME,
  CREATE_TABLES,
  type PhraseState,
} from './schema';
export {
  recordPhraseRepetition,
  getPhrasesForSession,
  getAllPhrases,
  ensurePhrase,
  type PhraseRow,
} from './phrases';
export {
  getProfile,
  saveProfile,
  addTokensUsed,
  setCodeGranted,
  getAccessState,
  TRIAL_TOKENS,
  CODE_TOKENS,
  type ProfileRow,
  type TargetLang,
  type AccessState,
} from './profile';
export {
  getTriggers,
  getGoals,
  getRecentEvents,
  getConversationMemory,
  saveConversationMemory,
  type TriggerRow,
  type GoalRow,
  type RecentEventRow,
  type ConversationMemory,
} from './memory';
