import { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { saveProfile } from '../db';
import type { TargetLang } from '../db';

const samAvatar = require('../../assets/sam-avatar.png');

const COLORS = {
  primary600: '#2F8FFF',
  primary100: '#EAF4FF',
  bgMain: '#F6F9FC',
  cardSurface: '#FFFFFF',
  divider: '#E3EAF2',
  textPrimary: '#1C2A39',
  textSecondary: '#5C6B7A',
  textMuted: '#8FA1B3',
};

interface OnboardingScreenProps {
  onDone: () => void;
}

export default function OnboardingScreen({ onDone }: OnboardingScreenProps) {
  const [name, setName] = useState('');
  const [targetLang, setTargetLang] = useState<TargetLang>('en');

  const handleDone = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await saveProfile({ name: trimmed, target_lang: targetLang });
    onDone();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Image source={samAvatar} style={styles.avatar} />
        <Text style={styles.title}>Friendly Sam</Text>
      </View>
      <Text style={styles.subtitle}>Как тебя зовут?</Text>
      <TextInput
        style={styles.input}
        placeholder="Имя"
        placeholderTextColor={COLORS.textMuted}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoCorrect={false}
      />

      <Text style={styles.label}>Какой язык учим?</Text>
      <View style={styles.langRow}>
        <TouchableOpacity
          style={[styles.langButton, targetLang === 'en' && styles.langButtonActive]}
          onPress={() => setTargetLang('en')}
        >
          <Text style={[styles.langButtonText, targetLang === 'en' && styles.langButtonTextActive]}>
            English
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.langButton, targetLang === 'pt' && styles.langButtonActive]}
          onPress={() => setTargetLang('pt')}
        >
          <Text style={[styles.langButtonText, targetLang === 'pt' && styles.langButtonTextActive]}>
            Português (PT)
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, !name.trim() && styles.primaryButtonDisabled]}
        onPress={handleDone}
        disabled={!name.trim()}
      >
        <Text style={styles.primaryButtonText}>Начать</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgMain,
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 12,
  },
  title: {
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontSize: 28,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  input: {
    backgroundColor: COLORS.cardSurface,
    borderWidth: 1,
    borderColor: COLORS.divider,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: COLORS.textPrimary,
    marginBottom: 32,
  },
  label: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  langRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 40,
  },
  langButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.divider,
    alignItems: 'center',
    backgroundColor: COLORS.cardSurface,
  },
  langButtonActive: {
    borderColor: COLORS.primary600,
    backgroundColor: COLORS.primary100,
  },
  langButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  langButtonTextActive: {
    color: COLORS.primary600,
  },
  primaryButton: {
    backgroundColor: COLORS.primary600,
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
