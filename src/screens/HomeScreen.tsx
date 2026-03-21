import { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
  Platform,
} from 'react-native';
import * as Speech from 'expo-speech';
import { getDb, getAllPhrases, getProfile, getAccessState, saveProfile, type AccessState } from '../db';
import SessionScreen from './SessionScreen';
import OnboardingScreen from './OnboardingScreen';
import UnlockScreen from './UnlockScreen';

const samAvatar = require('../../assets/sam-avatar.png');

type Screen = 'home' | 'session' | 'phrases' | 'onboarding' | 'unlock' | 'settings';

const COLORS = {
  primary500: '#4DA3FF',
  primary600: '#2F8FFF',
  primary100: '#EAF4FF',
  primary050: '#F4F9FF',
  bgMain: '#F6F9FC',
  cardSurface: '#FFFFFF',
  divider: '#E3EAF2',
  textPrimary: '#1C2A39',
  textSecondary: '#5C6B7A',
  textMuted: '#8FA1B3',
};

export default function HomeScreen() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [phrases, setPhrases] = useState<Awaited<ReturnType<typeof getAllPhrases>>>([]);
  const [accessState, setAccessState] = useState<AccessState | null>(null);
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof getProfile>>>(null);

  const refreshAccess = async () => {
    const p = await getProfile();
    setAccessState(getAccessState(p));
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await getDb();
        const p = await getProfile();
        if (mounted) {
          setProfile(p);
          const access = getAccessState(p);
          setAccessState(access);
          if (!p?.name?.trim()) setScreen('onboarding');
          else if (!access.canChat) setScreen('unlock');
        }
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const openPhrases = async () => {
    const list = await getAllPhrases();
    setPhrases(list);
    setScreen('phrases');
  };

  const speakPhrase = (phraseText: string, lang: 'en' | 'pt' = 'en') => {
    Speech.speak(phraseText, {
      language: lang === 'pt' ? 'pt-PT' : 'en-US',
      rate: 0.9,
    });
  };

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary600} />
      </View>
    );
  }

  if (screen === 'unlock' && accessState && !accessState.canChat) {
    return (
      <UnlockScreen
        reason={accessState.reason}
        onUnlocked={async () => {
          await refreshAccess();
          setScreen('home');
        }}
      />
    );
  }

  if (screen === 'session') {
    return (
      <SessionScreen
        onBack={() => setScreen('home')}
        accessState={accessState}
        onTrialOver={() => { refreshAccess(); setScreen('unlock'); }}
      />
    );
  }

  if (screen === 'onboarding') {
    return (
      <OnboardingScreen
        onDone={() => setScreen('home')}
      />
    );
  }

  if (screen === 'settings') {
    const targetLangLabel = profile?.target_lang === 'pt' ? 'португальского' : 'английского';
    const targetLangShort = profile?.target_lang === 'pt' ? 'PT' : 'EN';
    const coachMode = Math.min(7, Math.max(0, Math.round(profile?.coach_mode ?? 3)));
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={() => setScreen('home')}>
          <Text style={styles.backButtonText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Режим Sam</Text>
        <Text style={styles.screenSubtitle}>
          Больше русского — проще фразы. Больше {targetLangLabel} — сложнее. Уровень сам подстраивается под то, как ты говоришь.
        </Text>
        <View style={styles.sliderContainer}>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderEndLabel}>RU</Text>
            <View style={styles.sliderTrack}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.sliderDot, v === coachMode && styles.sliderDotActive]}
                  onPress={async () => {
                    await saveProfile({ coach_mode: v });
                    const p = await getProfile();
                    setProfile(p);
                  }}
                >
                  <Text style={[styles.sliderDotText, v === coachMode && styles.sliderDotTextActive]}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.sliderEndLabel}>{targetLangShort}</Text>
          </View>
          <View style={styles.sliderLabelsRow}>
            <Text style={styles.sliderLabelSide}>Mostly Russian</Text>
            <Text style={styles.sliderLabelCenter}>Balanced</Text>
            <Text style={styles.sliderLabelSide}>Mostly {targetLangShort}</Text>
          </View>
        </View>
      </View>
    );
  }

  if (screen === 'phrases') {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={() => setScreen('home')}>
          <Text style={styles.backButtonText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Мои фразы</Text>
        <Text style={styles.screenSubtitle}>
          Перечитать с переводом, послушать, повторить.
        </Text>
        <ScrollView style={styles.phrasesList}>
          {phrases.length === 0 ? (
            <Text style={styles.placeholderText}>Пока нет сохранённых фраз. Они появятся в сессиях.</Text>
          ) : (
            phrases.map((p) => (
              <View key={p.id} style={styles.phraseCard}>
                <Text style={styles.phraseText}>{p.phrase_text}</Text>
                {p.translation ? (
                  <Text style={styles.phraseTranslation}>{p.translation}</Text>
                ) : null}
                <View style={styles.phraseActions}>
                  <TouchableOpacity
                    style={styles.phraseButton}
                    onPress={() => speakPhrase(p.phrase_text)}
                  >
                    <Text style={styles.phraseButtonText}>Послушать</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.phraseButton}
                    onPress={() => speakPhrase(p.phrase_text)}
                  >
                    <Text style={styles.phraseButtonText}>Повторить</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  const canStart = accessState?.canChat ?? true;

  return (
    <View style={styles.container}>
      <View style={styles.homeHeader}>
        <Image source={samAvatar} style={styles.homeAvatar} />
        <Text style={styles.homeTitle}>Friendly Sam</Text>
        <Text style={styles.homeSubtitle}>Говори больше — Sam подскажет</Text>
      </View>

      {accessState?.canChat && accessState.tokensRemaining < 10000 && accessState.tokensRemaining > 0 ? (
        <Text style={styles.tokensHint}>Осталось токенов: ~{Math.round(accessState.tokensRemaining / 1000)}k</Text>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryButton, !canStart && styles.primaryButtonDisabled]}
        activeOpacity={0.8}
        onPress={() => (canStart ? setScreen('session') : setScreen('unlock'))}
      >
        <Text style={styles.primaryButtonText}>{canStart ? 'Начать' : 'Продолжить — ввести код'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        activeOpacity={0.8}
        onPress={openPhrases}
      >
        <Text style={styles.secondaryButtonText}>Мои фразы</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsButton}
        activeOpacity={0.8}
        onPress={async () => { const p = await getProfile(); setProfile(p); setScreen('settings'); }}
      >
        <Text style={styles.settingsButtonText}>Настройки</Text>
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bgMain,
  },
  homeHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  homeAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 16,
  },
  homeTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontSize: 28,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  homeSubtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  tokensHint: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: COLORS.primary600,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: COLORS.cardSurface,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  secondaryButtonText: {
    color: COLORS.primary600,
    fontSize: 16,
    fontWeight: '500',
  },
  settingsButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  settingsButtonText: {
    color: COLORS.textMuted,
    fontSize: 15,
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
  screenTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontSize: 24,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  screenSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
    lineHeight: 20,
  },
  placeholderText: {
    fontSize: 15,
    color: COLORS.textMuted,
  },
  phrasesList: {
    flex: 1,
  },
  phraseCard: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  phraseText: {
    fontSize: 17,
    color: COLORS.textPrimary,
    marginBottom: 4,
    fontWeight: '500',
  },
  phraseTranslation: {
    fontSize: 15,
    color: COLORS.textSecondary,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  phraseActions: {
    flexDirection: 'row',
    gap: 12,
  },
  phraseButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: COLORS.primary100,
    borderRadius: 8,
  },
  phraseButtonText: {
    fontSize: 14,
    color: COLORS.primary600,
    fontWeight: '500',
  },
  sliderContainer: {
    marginTop: 8,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sliderEndLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    width: 24,
    textAlign: 'center',
  },
  sliderTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sliderDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.divider,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sliderDotActive: {
    backgroundColor: COLORS.primary600,
  },
  sliderDotText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  sliderDotTextActive: {
    color: '#fff',
  },
  sliderLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: 24,
  },
  sliderLabelSide: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  sliderLabelCenter: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
});
