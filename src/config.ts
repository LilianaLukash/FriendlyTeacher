import Constants from 'expo-constants';

/**
 * API base URL. Set EXPO_PUBLIC_API_URL in root .env (e.g. http://192.168.1.212:3000).
 * Expo injects EXPO_PUBLIC_* at build time; extra.apiUrl is from app.config.js.
 */
const fromEnv =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL;
const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
export const API_URL =
  (fromEnv || extra?.apiUrl || 'http://localhost:3000').trim();

/** Контакт для получения нового кода продления (email, Telegram и т.д.) */
export const CONTACT_FOR_CODE =
  (extra?.contactForCode as string | undefined)?.trim() ||
  'Напишите нам для получения кода: укажите EXPO_PUBLIC_CONTACT_FOR_CODE в .env';
