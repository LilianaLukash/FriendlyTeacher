import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Audio } from 'expo-av';
import {
  getProfile,
  getPhrasesForSession,
  recordPhraseRepetition,
  getTriggers,
  getGoals,
  getRecentEvents,
  getConversationMemory,
  saveConversationMemory,
  addTokensUsed,
  getAccessState,
  saveProfile,
  type AccessState,
} from '../db';
import { phraseMatches } from '../utils/phraseMatch';
import { getTtsSegments, stripTtsMarkupForDisplay, type TtsSegment } from '../utils/ttsLanguage';
import { API_URL } from '../config';

const samAvatar = require('../../assets/sam-avatar.png');

/** Локаль expo-speech по ISO-коду сегмента (расширяйте при новых языках). */
const EXPO_SPEECH_LOCALE: Record<string, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  pt: 'pt-PT',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  it: 'it-IT',
  pl: 'pl-PL',
  uk: 'uk-UA',
};
function expoSpeechLocaleForCode(code: string): string {
  return EXPO_SPEECH_LOCALE[code.toLowerCase()] ?? 'en-US';
}

/** Баланс громкости: голоса ElevenLabs по-разному громкие; PT часто тише RU — без смены голоса. */
function playbackVolumeForTtsLang(lang: string): number {
  const c = lang.toLowerCase().slice(0, 2);
  if (c === 'pt') return 1.0;
  if (c === 'ru') return 0.72;
  return 0.92; // en и др.
}

type SessionStatus = 'idle' | 'sending' | 'speaking' | 'recording';

interface ChatMessage {
  role: 'user' | 'sam';
  text: string;
}

interface SessionScreenProps {
  onBack: () => void;
  accessState: AccessState | null;
  onTrialOver: () => void;
}

const COLORS = {
  primary500: '#4DA3FF',
  primary600: '#2F8FFF',
  primary100: '#EAF4FF',
  primary050: '#F4F9FF',
  bgMain: '#F6F9FC',
  cardSurface: '#FFFFFF',
  userBubble: '#F0F4F8',
  samBubble: '#EAF4FF',
  divider: '#E3EAF2',
  textPrimary: '#1C2A39',
  textSecondary: '#5C6B7A',
  textMuted: '#8FA1B3',
  recording: '#E53935',
};

function getSliderLabel(level: number, targetLang: 'en' | 'pt'): string {
  const langName = targetLang === 'pt' ? 'Portuguese' : 'English';
  if (level <= 1) return 'Mostly Russian';
  if (level === 2) return 'More Russian';
  if (level === 3 || level === 4) return 'Balanced';
  if (level === 5) return `More ${langName}`;
  return `Mostly ${langName}`;
}

export default function SessionScreen({ onBack, accessState, onTrialOver }: SessionScreenProps) {
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof getProfile>>>(null);
  const [sessionPhrases, setSessionPhrases] = useState<Awaited<ReturnType<typeof getPhrasesForSession>>>([]);
  const [triggers, setTriggers] = useState<Awaited<ReturnType<typeof getTriggers>>>([]);
  const [goals, setGoals] = useState<Awaited<ReturnType<typeof getGoals>>>([]);
  const [recentEvents, setRecentEvents] = useState<Awaited<ReturnType<typeof getRecentEvents>>>([]);
  const [conversationMemory, setConversationMemory] =
    useState<Awaited<ReturnType<typeof getConversationMemory>> | null>(null);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [coachMode, setCoachMode] = useState(3);
  const scrollRef = useRef<ScrollView>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [p, phrases, tr, g, ev, mem] = await Promise.all([
        getProfile(),
        getPhrasesForSession(),
        getTriggers(),
        getGoals(),
        getRecentEvents(),
        getConversationMemory(),
      ]);
      if (mounted) {
        setProfile(p);
        setCoachMode(Math.min(7, Math.max(0, Math.round(p?.coach_mode ?? 3))));
        setSessionPhrases(phrases);
        setTriggers(tr);
        setGoals(g);
        setRecentEvents(ev);
        setConversationMemory(mem);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const targetLang = profile?.target_lang === 'pt' ? 'pt' : 'en';
  const targetLangLabel = targetLang === 'pt' ? 'PT' : 'EN';

  const appendAndScroll = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleCoachModeChange = async (v: number) => {
    setCoachMode(v);
    await saveProfile({ coach_mode: v });
  };

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        alert('Нужно разрешение на микрофон');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const recordingOptions: Audio.RecordingOptions = {
        isMeteringEnabled: false,
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.MEDIUM,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 64000,
        },
      };
      const { recording } = await Audio.Recording.createAsync(recordingOptions);
      recordingRef.current = recording;
      setStatus('recording');
    } catch (err) {
      console.error('Failed to start recording', err);
      setStatus('idle');
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) {
      setStatus('idle');
      return;
    }
    setStatus('sending');
    try {
      console.log('[Recording] Stopping...');
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      console.log('[Recording] URI:', uri);
      recordingRef.current = null;
      if (uri) {
        await sendAudio(uri);
      } else {
        console.log('[Recording] No URI');
        setStatus('idle');
      }
    } catch (err) {
      console.error('[Recording] Failed to stop:', err);
      recordingRef.current = null;
      setStatus('idle');
    }
  };

  const sendAudio = async (uri: string) => {
    try {
      console.log('[Audio] Uploading file...', uri);
      
      const formData = new FormData();
      formData.append('audio', {
        uri: uri,
        type: 'audio/m4a',
        name: 'recording.m4a',
      } as unknown as Blob);
      formData.append('coachMode', String(coachMode));
      
      const currentProfile = await getProfile();
      const targetLangForRequest = currentProfile?.target_lang === 'pt' ? 'pt' : 'en';
      formData.append('targetLang', targetLangForRequest);
      formData.append('tokens_used_total', String(currentProfile?.tokens_used ?? 0));
      formData.append('code_expires_at', currentProfile?.code_expires_at ?? '');
      formData.append('tokens_used_at_code_entry', String(currentProfile?.tokens_used_at_code_entry ?? 0));
      
      const memoryContext: Record<string, unknown> = {
        name: currentProfile?.name ?? undefined,
        target_lang: currentProfile?.target_lang ?? 'en',
        city: currentProfile?.city ?? undefined,
        partner: currentProfile?.partner ?? undefined,
        children: currentProfile?.children_json ?? undefined,
        triggers: triggers.map((t) => t.text),
        goals: goals.map((g) => g.text),
        recent_events: recentEvents.map((e) => ({ emotion: e.emotion, context: e.context })),
        memory_summary: conversationMemory?.summary ?? undefined,
      };
      formData.append('memoryContext', JSON.stringify(memoryContext));
      formData.append('recentMessages', JSON.stringify(messages.slice(-6)));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      
      console.log('[Audio] Sending to /chat-audio...');
      const res = await fetch(`${API_URL}/chat-audio`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 403) {
        const data = await res.json().catch(() => ({})) as { trial_over?: boolean };
        if (data.trial_over) {
          onTrialOver();
          return;
        }
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[Audio] Server error:', err);
        setMessages((m) => [...m, { role: 'sam', text: `Ошибка: ${err.error || res.status}` }]);
        setStatus('idle');
        return;
      }

      const data = (await res.json()) as { reply: string; tokensUsed: number; transcript?: string };
      console.log('[Audio] Got reply, transcript:', data.transcript);
      
      await addTokensUsed(data.tokensUsed ?? 0);
      
      const recognizedText = data.transcript || '';
      const userMsg = recognizedText ? { role: 'user' as const, text: recognizedText } : null;
      const samDisplay = stripTtsMarkupForDisplay(data.reply);
      const samMsg = { role: 'sam' as const, text: samDisplay };
      
      const nextMessages = userMsg ? [...messages, userMsg, samMsg] : [...messages, samMsg];
      setMessages(nextMessages);
      setTotalTokens((t) => t + (data.tokensUsed ?? 0));
      appendAndScroll();

      setStatus('speaking');
      await playTts(data.reply, targetLangForRequest);
    } catch (err) {
      console.error('[Audio] Failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((m) => [...m, { role: 'sam', text: `Ошибка: ${msg}` }]);
      setStatus('idle');
    }
  };

  const playTts = async (text: string, targetLangForTts: 'en' | 'pt') => {
    const segments = getTtsSegments(text, targetLangForTts).filter((s) => s.text.trim());
    if (segments.length === 0) {
      setStatus('idle');
      return;
    }

    // На весь ответ: не зависнуть в speaking.
    const speakSafetyTimer = setTimeout(() => setStatus('idle'), 180000);

    const parseTtsError = (errText: string) => {
      let detail = errText;
      try {
        const j = JSON.parse(errText) as { error?: string; detail?: unknown };
        if (typeof j.detail === 'string') detail = j.detail;
        else if (Array.isArray(j.detail) && j.detail[0]?.msg) detail = String(j.detail[0].msg);
        else if (j.error) detail = j.error;
      } catch {
        /* keep raw */
      }
      return detail;
    };

    const playSegmentAudio = (audioUri: string, segmentLang: string) =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        Audio.Sound.createAsync(
          { uri: audioUri },
          { shouldPlay: true, progressUpdateIntervalMillis: 200, volume: playbackVolumeForTtsLang(segmentLang) }
        )
          .then(async ({ sound }) => {
            soundRef.current = sound;
            await sound.setVolumeAsync(playbackVolumeForTtsLang(segmentLang)).catch(() => undefined);
            sound.setOnPlaybackStatusUpdate((st) => {
              if (!st.isLoaded) return;
              if (st.didJustFinish) {
                finish();
                return;
              }
              if ('error' in st && st.error) {
                if (!settled) {
                  settled = true;
                  reject(new Error(String(st.error)));
                }
              }
            });
          })
          .catch(reject);
      });

    const fetchTtsMp3 = async (seg: TtsSegment) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(`${API_URL}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: seg.text, language: seg.apiLanguage }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`TTS failed: HTTP ${res.status}. ${parseTtsError(errText)}`);
        }
        const data = (await res.json()) as { audio: string; format: string };
        return `data:audio/mp3;base64,${data.audio}`;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const playAllElevenLabs = async () => {
      for (const seg of segments) {
        if (soundRef.current) {
          await soundRef.current.unloadAsync().catch(() => undefined);
          soundRef.current = null;
        }
        const uri = await fetchTtsMp3(seg);
        await playSegmentAudio(uri, seg.apiLanguage);
      }
    };

    const playAllExpoSpeech = (list: TtsSegment[], index: number, safetyTimer: ReturnType<typeof setTimeout>) => {
      const Speech = require('expo-speech');
      if (index >= list.length) {
        clearTimeout(safetyTimer);
        clearTimeout(speakSafetyTimer);
        setStatus('idle');
        return;
      }
      const seg = list[index];
      const lang = expoSpeechLocaleForCode(seg.apiLanguage);
      Speech.speak(seg.text, {
        language: lang,
        rate: 0.9,
        ...(Platform.OS === 'android' && {
          volume: seg.apiLanguage.toLowerCase().slice(0, 2) === 'pt' ? 1 : seg.apiLanguage.toLowerCase().slice(0, 2) === 'ru' ? 0.75 : 0.9,
        }),
        onDone: () => playAllExpoSpeech(list, index + 1, safetyTimer),
        onStopped: () => playAllExpoSpeech(list, index + 1, safetyTimer),
        onError: () => playAllExpoSpeech(list, index + 1, safetyTimer),
      });
    };

    try {
      await playAllElevenLabs();
      clearTimeout(speakSafetyTimer);
      setStatus('idle');
    } catch (err) {
      console.error('TTS error, falling back to system TTS (segmented)', err);
      clearTimeout(speakSafetyTimer);
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => undefined);
        soundRef.current = null;
      }
      const safetyTimer = setTimeout(() => setStatus('idle'), 120000);
      playAllExpoSpeech(segments, 0, safetyTimer);
    }
  };

  const sendMessage = async (text?: string, audioBase64?: string) => {
    const transcript = text !== undefined ? text.trim() : input.trim();
    if (!transcript && !audioBase64) return;
    if (status !== 'idle' && status !== 'sending') return;
    
    const currentProfile = await getProfile();
    const targetLangForRequest = currentProfile?.target_lang === 'pt' ? 'pt' : 'en';
    const access = getAccessState(currentProfile);
    if (!access.canChat) {
      onTrialOver();
      return;
    }

    setInput('');
    setStatus('sending');
    if (transcript) {
      setMessages((m) => [...m, { role: 'user', text: transcript }]);
    }
    appendAndScroll();

    try {
      const memoryContext: Record<string, unknown> = {
        name: currentProfile?.name ?? undefined,
        target_lang: currentProfile?.target_lang ?? 'en',
        city: currentProfile?.city ?? undefined,
        partner: currentProfile?.partner ?? undefined,
        children: currentProfile?.children_json ?? undefined,
        triggers: triggers.map((t) => t.text),
        goals: goals.map((g) => g.text),
        recent_events: recentEvents.map((e) => ({ emotion: e.emotion, context: e.context })),
        memory_summary: conversationMemory?.summary ?? undefined,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: transcript || undefined,
          audioBase64,
          memoryContext,
          targetLang: targetLangForRequest,
          recentMessages: messages.slice(-6),
          tokens_used_total: currentProfile?.tokens_used ?? 0,
          code_expires_at: currentProfile?.code_expires_at ?? null,
          tokens_used_at_code_entry: currentProfile?.tokens_used_at_code_entry ?? 0,
          coachMode,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 403) {
        const data = await res.json().catch(() => ({})) as { trial_over?: boolean };
        if (data.trial_over) {
          onTrialOver();
          return;
        }
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessages((m) => [...m, { role: 'sam', text: `Ошибка: ${err.error || res.status}` }]);
        setStatus('idle');
        appendAndScroll();
        return;
      }

      const data = (await res.json()) as { reply: string; tokensUsed: number; transcript?: string };
      await addTokensUsed(data.tokensUsed ?? 0);
      
      const recognizedText = data.transcript || transcript;
      const userMsg = recognizedText ? { role: 'user' as const, text: recognizedText } : null;
      const samDisplay = stripTtsMarkupForDisplay(data.reply);
      const samMsg = { role: 'sam' as const, text: samDisplay };
      
      let nextMessages: ChatMessage[];
      if (userMsg && !transcript) {
        nextMessages = [...messages, userMsg, samMsg];
      } else {
        nextMessages = [...messages, ...(transcript ? [] : []), samMsg];
        if (transcript) {
          nextMessages = [...messages, { role: 'user', text: transcript }, samMsg];
        }
      }
      
      setMessages(nextMessages);
      setTotalTokens((t) => t + (data.tokensUsed ?? 0));
      appendAndScroll();

      for (const phrase of sessionPhrases) {
        if (recognizedText && phraseMatches(recognizedText, phrase.phrase_text)) {
          await recordPhraseRepetition(phrase.id, recognizedText, samDisplay.slice(0, 80));
        }
      }

      (async () => {
        try {
          const snippet = nextMessages
            .slice(-8)
            .map((m) => `${m.role === 'user' ? 'User' : 'Sam'}: ${m.text}`)
            .join('\n');
          const memRes = await fetch(`${API_URL}/memory-update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              previousMemory: conversationMemory?.json ?? {},
              dialogueSnippet: snippet,
              targetLang: targetLangForRequest,
            }),
          });
          if (!memRes.ok) return;
          const memData = (await memRes.json()) as { memory?: { facts?: unknown; preferences?: unknown; emotional_patterns?: unknown; recent_events?: unknown; summary?: string } };
          if (!memData.memory) return;
          const nextMemory = {
            json: memData.memory,
            summary: memData.memory.summary ?? '',
          };
          await saveConversationMemory(nextMemory);
          setConversationMemory({
            json: nextMemory.json,
            summary: nextMemory.summary,
            updated_at: new Date().toISOString(),
          });
        } catch {
          // ignore
        }
      })();

      setStatus('speaking');
      await playTts(data.reply, targetLangForRequest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isAbort = msg.includes('abort') || msg.includes('Abort');
      const errText =
        msg.includes('network') || msg.includes('Network') || isAbort
          ? `Ошибка сети (${msg}). Сервер запущен?`
          : `Ошибка: ${msg}`;
      setMessages((m) => [...m, { role: 'sam', text: errText }]);
      setStatus('idle');
      appendAndScroll();
    }
  };

  const handleMicPress = () => {
    if (status === 'recording') {
      stopRecording();
    } else if (status === 'idle') {
      startRecording();
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Sam</Text>
      </View>

      {/* Language Balance Slider */}
      <View style={styles.sliderContainer}>
        <View style={styles.sliderRow}>
          <Text style={styles.sliderEndLabel}>RU</Text>
          <View style={styles.sliderTrack}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.sliderDot, v === coachMode && styles.sliderDotActive]}
                onPress={() => handleCoachModeChange(v)}
              >
                <Text style={[styles.sliderDotText, v === coachMode && styles.sliderDotTextActive]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.sliderEndLabel}>{targetLangLabel}</Text>
        </View>
        <Text style={styles.sliderLabel}>{getSliderLabel(coachMode, targetLang)}</Text>
      </View>

      {/* Chat Area */}
      <ScrollView
        ref={scrollRef}
        style={styles.chat}
        contentContainerStyle={styles.chatContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Image source={samAvatar} style={styles.emptyAvatar} />
            <Text style={styles.emptyText}>Привет! Расскажи немного о себе — я подстроюсь под тебя.</Text>
          </View>
        ) : null}
        {messages.map((msg, i) =>
          msg.role === 'user' ? (
            <View key={i} style={styles.bubbleUserRow}>
              <View style={styles.bubbleUser}>
                <Text style={styles.bubbleUserText}>{msg.text}</Text>
              </View>
            </View>
          ) : (
            <View key={i} style={styles.bubbleSamRow}>
              <Image source={samAvatar} style={styles.samAvatar} />
              <View style={styles.bubbleSam}>
                <Text style={styles.bubbleSamText}>{msg.text}</Text>
              </View>
            </View>
          )
        )}
        {status === 'speaking' ? (
          <View style={styles.bubbleSamRow}>
            <Image source={samAvatar} style={styles.samAvatar} />
            <View style={[styles.bubbleSam, styles.bubbleSamSpeaking]}>
              <Text style={styles.samSpeakingLabel}>Sam говорит...</Text>
              <ActivityIndicator size="small" color={COLORS.primary600} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Voice Input Area */}
      <View style={styles.footer}>
        {status === 'sending' ? (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={COLORS.primary600} />
            <Text style={styles.statusText}>Думаю...</Text>
          </View>
        ) : status === 'recording' ? (
          <View style={styles.statusRow}>
            <View style={styles.recordingDot} />
            <Text style={styles.statusText}>Запись... нажми чтобы остановить</Text>
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <TouchableOpacity
            style={[
              styles.micButton,
              status === 'recording' && styles.micButtonRecording,
              (status === 'sending' || status === 'speaking') && styles.micButtonDisabled,
            ]}
            onPress={handleMicPress}
            disabled={status === 'sending' || status === 'speaking'}
          >
            <Text style={styles.micButtonText}>{status === 'recording' ? '■' : '🎤'}</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Или напиши..."
            placeholderTextColor={COLORS.textMuted}
            value={input}
            onChangeText={setInput}
            editable={status === 'idle'}
            multiline
            maxLength={500}
            onSubmitEditing={() => sendMessage()}
          />
          <TouchableOpacity
            style={[styles.sendButton, (status !== 'idle' || !input.trim()) && styles.sendButtonDisabled]}
            onPress={() => sendMessage()}
            disabled={status !== 'idle' || !input.trim()}
          >
            <Text style={styles.sendButtonText}>→</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgMain,
  },
  header: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginBottom: 4,
  },
  backButtonText: {
    color: COLORS.textSecondary,
    fontSize: 15,
  },
  title: {
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontSize: 26,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  sliderContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
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
  sliderLabel: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  chat: {
    flex: 1,
    paddingHorizontal: 16,
  },
  chatContent: {
    paddingVertical: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 24,
  },
  bubbleUserRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 12,
  },
  bubbleUser: {
    backgroundColor: COLORS.userBubble,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderTopRightRadius: 4,
    maxWidth: '80%',
  },
  bubbleUserText: {
    fontSize: 17,
    color: COLORS.textPrimary,
    lineHeight: 24,
  },
  bubbleSamRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  samAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 8,
  },
  bubbleSam: {
    backgroundColor: COLORS.samBubble,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderTopLeftRadius: 4,
    maxWidth: '80%',
  },
  bubbleSamText: {
    fontSize: 17,
    color: COLORS.textPrimary,
    lineHeight: 24,
  },
  bubbleSamSpeaking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  samSpeakingLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.primary600,
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    paddingTop: 12,
    backgroundColor: COLORS.bgMain,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.recording,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButtonRecording: {
    backgroundColor: COLORS.recording,
  },
  micButtonDisabled: {
    backgroundColor: COLORS.divider,
  },
  micButtonText: {
    fontSize: 20,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.cardSurface,
    borderWidth: 1,
    borderColor: COLORS.divider,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.textPrimary,
    maxHeight: 100,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary600,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.divider,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
});
