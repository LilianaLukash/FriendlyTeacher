import { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { setCodeGranted, type AccessState } from '../db';
import { API_URL, CONTACT_FOR_CODE } from '../config';

type Reason = AccessState extends { canChat: false; reason: infer R } ? R : never;

const COLORS = {
  primary600: '#2F8FFF',
  primary100: '#EAF4FF',
  bgMain: '#F6F9FC',
  cardSurface: '#FFFFFF',
  divider: '#E3EAF2',
  textPrimary: '#1C2A39',
  textSecondary: '#5C6B7A',
  textMuted: '#8FA1B3',
  error: '#E53935',
};

const REASON_TEXT: Record<Reason, string> = {
  trial_over: 'Пробный период закончился.',
  code_used_up: 'Лимит токенов по коду израсходован.',
};

interface UnlockScreenProps {
  reason: Reason;
  onUnlocked: () => void;
  onBack?: () => void;
  showBack?: boolean;
}

export default function UnlockScreen({
  reason,
  onUnlocked,
  onBack,
  showBack,
}: UnlockScreenProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitCode = async () => {
    const raw = code.trim();
    if (!raw) {
      setError('Введите код');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/validate-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: raw }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        tokensAdded?: number;
        expiresAt?: string | null;
        error?: string;
      };
      if (!data.success) {
        setError(data.error === 'invalid_or_expired' ? 'Код неверный.' : 'Ошибка проверки кода.');
        return;
      }
      await setCodeGranted(data.expiresAt ?? '');
      onUnlocked();
    } catch (e) {
      setError('Нет связи с сервером. Проверьте интернет и адрес API.');
    } finally {
      setLoading(false);
    }
  };

  const openContact = () => {
    const t = CONTACT_FOR_CODE;
    const telMatch = t.match(/https?:\/\/[^\s]+/);
    const url = telMatch ? telMatch[0] : (t.includes('@') ? `mailto:${t.match(/[\w.-]+@[\w.-]+/)?.[0] || ''}` : null);
    if (url) Linking.openURL(url);
  };

  return (
    <View style={styles.container}>
      {showBack && onBack ? (
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Назад</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.title}>Продолжить занятия</Text>
      <Text style={styles.reason}>{REASON_TEXT[reason]}</Text>
      <Text style={styles.contactLabel}>Чтобы получить новый код:</Text>
      <TouchableOpacity onPress={openContact}>
        <Text style={styles.contact}>{CONTACT_FOR_CODE}</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>Код даёт примерно 2 недели занятий (по токенам).</Text>
      <Text style={styles.formatHint}>Формат: SAM-XXXX-XXXX (латиница и цифры 2–7; не путайте 0 с O и 1 с I).</Text>
      <TextInput
        style={styles.input}
        placeholder="Введите код продления"
        placeholderTextColor={COLORS.textMuted}
        value={code}
        onChangeText={(t) => { setCode(t); setError(null); }}
        editable={!loading}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={submitCode}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Продолжить</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgMain,
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginBottom: 12,
  },
  backButtonText: {
    color: COLORS.textSecondary,
    fontSize: 15,
  },
  title: {
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontSize: 24,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  reason: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  contactLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  contact: {
    fontSize: 16,
    color: COLORS.primary600,
    textDecorationLine: 'underline',
    marginBottom: 16,
  },
  hint: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 8,
  },
  formatHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 20,
    lineHeight: 17,
  },
  input: {
    backgroundColor: COLORS.cardSurface,
    borderWidth: 1,
    borderColor: COLORS.divider,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  error: {
    fontSize: 14,
    color: COLORS.error,
    marginBottom: 8,
  },
  button: {
    backgroundColor: COLORS.primary600,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
