import Constants from 'expo-constants';

/**
 * API base URL. Прод: https://friendlyteacher-production.up.railway.app
 * Локально: EXPO_PUBLIC_API_URL в корневом .env (например http://192.168.x.x:3000).
 * Expo injects EXPO_PUBLIC_* at build time; extra.apiUrl — из app.config.js.
 */
const fromEnv =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL;
const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
export const API_URL = (
  fromEnv ||
  extra?.apiUrl ||
  'https://friendlyteacher-production.up.railway.app'
).trim();

/** Контакт для получения нового кода продления (email, Telegram и т.д.) */
export const CONTACT_FOR_CODE =
  (extra?.contactForCode as string | undefined)?.trim() ||
  'Напишите нам для получения кода: укажите EXPO_PUBLIC_CONTACT_FOR_CODE в .env';
