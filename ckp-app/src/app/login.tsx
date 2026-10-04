/**
 * 로그인 — 앱처럼 보이는 아이콘 중심 화면.
 * 인사말·안내 문장은 두지 않는다. 계정 문의 안내는 도움말(?) 아이콘을 눌렀을 때만 보인다.
 * 회원가입은 meta.features.selfRegistration 이 false 가 아니면 버튼으로 노출한다.
 */
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, type TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, IconButton, ModeBanner, Text, TextField, alertDialog } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import { webOnly } from '@/components/ui/web-props';
import { AuthBrandPanel, AuthMobileHero } from '@/features/auth/AuthBrandPanel';
import { FormBanner } from '@/features/auth/FormBanner';
import { ApiError, MSG } from '@/lib/api/errors';
import { useAuth, useFeatures } from '@/lib/auth';
import { colors, radius, shadow, spacing, useIsWide } from '@/theme';

/** apr_yn 상태별 안내 (서버 메시지가 없을 때 사용) */
const APPROVAL_MESSAGES: Record<string, string> = {
  N: '관리자 승인 대기중입니다.',
  D: '삭제 요청된 상태입니다.',
  R: '승인 보류된 상태입니다.',
  S: '접속차단 상태입니다.',
};

const ACCOUNT_HELP = '계정 발급·비밀번호 초기화는 관리자에게 문의해 주세요.';

interface FormNotice {
  tone: 'danger' | 'warning';
  title?: string;
  message: string;
}

function describeLoginError(error: unknown): FormNotice {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'ACCOUNT_NOT_APPROVED': {
        const status = typeof error.details.status === 'string' ? error.details.status : '';
        return {
          tone: 'warning',
          title: '로그인할 수 없는 계정입니다',
          message: error.message || APPROVAL_MESSAGES[status] || '관리자에게 승인 상태를 확인하십시오.',
        };
      }
      case 'INVALID_CREDENTIALS':
        return { tone: 'danger', message: error.message || '아이디 또는 비밀번호가 올바르지 않습니다.' };
      case 'RATE_LIMITED':
        return { tone: 'warning', title: '잠시 후 다시 시도해 주세요', message: error.message || MSG.rateLimited };
      default:
        return { tone: 'danger', message: error.message };
    }
  }
  return { tone: 'danger', message: MSG.unknown };
}

/** 그라데이션 주요 버튼 (로그인) */
function GradientButton({
  title,
  icon,
  loading,
  onPress,
}: {
  title: string;
  icon: 'log-in-outline';
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: loading, busy: loading }}
      style={(state) => {
        const { pressed, hovered } = asInteraction(state);
        return [styles.gradientWrap, (pressed || hovered) && styles.gradientHover, pressed && styles.gradientPressed];
      }}
    >
      <LinearGradient
        colors={[colors.primary, '#0A8FCB', colors.teal]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <Icon name={icon} size={20} color={colors.white} />
        <Text variant="button" color={colors.white}>
          {title}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

export default function LoginScreen() {
  const { signIn, restoreError, retryRestore } = useAuth();
  const features = useFeatures();
  const params = useLocalSearchParams<{ usrId?: string }>();
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInput>(null);
  const submitting = useRef(false);

  // 회원가입 완료 후 돌아오면 아이디를 채워 둔다
  const [usrId, setUsrId] = useState(() => (typeof params.usrId === 'string' ? params.usrId.slice(0, 20) : ''));
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ usrId?: string; password?: string }>({});
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function submit() {
    if (submitting.current) return;
    const errors: { usrId?: string; password?: string } = {};
    if (!usrId.trim()) errors.usrId = '아이디를 입력해 주세요.';
    if (!password) errors.password = '비밀번호를 입력해 주세요.';
    setFieldErrors(errors);
    setNotice(null);
    if (errors.usrId || errors.password) return;

    submitting.current = true;
    setLoading(true);
    try {
      await signIn(usrId.trim(), password);
      // 성공하면 Stack.Protected 가 앱 화면으로 전환한다
    } catch (error) {
      const next = describeLoginError(error);
      if (error instanceof ApiError && Object.keys(error.fields).length) {
        setFieldErrors({ usrId: error.fields.usrId, password: error.fields.password });
      }
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        setPassword('');
        passwordRef.current?.focus();
      }
      setNotice(next);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  async function retry() {
    setRetrying(true);
    try {
      await retryRestore();
    } finally {
      setRetrying(false);
    }
  }

  const form = (
    <View style={[styles.card, wide && styles.cardWide]}>
      <View style={styles.cardTop}>
        <LinearGradient colors={[colors.primarySoft, '#DDF3F0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badge}>
          <Icon name="person" size={30} color={colors.primary} />
        </LinearGradient>
        <Text variant="heading" role="heading" style={styles.srOnlyHeading} {...webOnly({ 'aria-level': 1 })}>
          로그인
        </Text>
        <ModeBanner variant="pill" style={styles.modePill} />
      </View>

      {restoreError ? (
        <FormBanner tone="warning" icon="cloud-offline-outline" message={restoreError} live>
          <Button title="다시 연결" size="sm" variant="secondary" icon="refresh" onPress={retry} loading={retrying} />
        </FormBanner>
      ) : null}

      <View style={styles.fields}>
        <TextField
          accessibilityLabel="아이디"
          placeholder="아이디"
          value={usrId}
          onChangeText={(t) => {
            setUsrId(t);
            if (fieldErrors.usrId) setFieldErrors((f) => ({ ...f, usrId: undefined }));
          }}
          error={fieldErrors.usrId}
          leftIcon="person-outline"
          leftIconColor={colors.primary}
          shape="pill"
          containerStyle={styles.field}
          inputStyle={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          maxLength={20}
          onSubmitEditing={() => passwordRef.current?.focus()}
          submitBehavior="submit"
          editable={!loading}
        />
        <TextField
          ref={passwordRef}
          accessibilityLabel="비밀번호"
          placeholder="비밀번호"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
          }}
          error={fieldErrors.password}
          leftIcon="lock-closed-outline"
          leftIconColor={colors.primary}
          shape="pill"
          containerStyle={styles.field}
          inputStyle={styles.input}
          secureToggle
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          editable={!loading}
        />
      </View>

      {notice ? <FormBanner tone={notice.tone} title={notice.title} message={notice.message} live /> : null}

      <View style={styles.actions}>
        <GradientButton title={loading ? '로그인 중…' : '로그인'} icon="log-in-outline" loading={loading} onPress={() => void submit()} />
        {features.selfRegistration !== false ? (
          <Button
            title="회원가입"
            icon="person-add-outline"
            variant="soft"
            size="lg"
            labelVariant="button"
            fullWidth
            disabled={loading}
            style={styles.pillButton}
            onPress={() => router.push('/signup')}
          />
        ) : null}
      </View>

      <View style={styles.helpRow}>
        <IconButton
          icon="help-circle-outline"
          accessibilityLabel="계정 문의 안내"
          iconSize={22}
          color={colors.textMuted}
          onPress={() => void alertDialog({ title: '계정 문의', message: ACCOUNT_HELP, confirmText: '확인' })}
        />
      </View>
    </View>
  );

  if (wide) {
    return (
      <View style={styles.wideRoot}>
        <StatusBar style="light" />
        <AuthBrandPanel />
        <ScrollView style={styles.flex} contentContainerStyle={styles.wideFormWrap} keyboardShouldPersistTaps="handled">
          {form}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.mobileRoot}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'web' ? undefined : 'padding'} enabled={Platform.OS !== 'web'}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.mobileContent, { paddingBottom: insets.bottom + spacing.xxl }]}
          keyboardShouldPersistTaps="handled"
        >
          <AuthMobileHero topInset={insets.top} />
          <View style={styles.mobileFormWrap}>{form}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // 모바일: 위쪽 그라데이션 로고 영역 + 겹쳐 올라오는 흰 카드
  mobileRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  mobileContent: {
    flexGrow: 1,
  },
  mobileFormWrap: {
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginTop: -(spacing.xxxl + spacing.md),
  },
  // 넓은 화면
  wideRoot: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.bg,
  },
  wideFormWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxxl,
  },
  // 카드
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.card,
    borderRadius: 28,
    padding: spacing.xl,
    paddingTop: spacing.xxl,
    gap: spacing.xl,
    ...shadow.overlay,
  },
  cardWide: {
    maxWidth: 380,
    padding: spacing.xxl,
    paddingTop: spacing.xxxl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.raised,
  },
  cardTop: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 6px 18px rgba(8, 110, 175, 0.18)',
  },
  // 화면에는 보이지 않고 스크린리더만 읽는 제목 (아이콘이 제목 역할)
  srOnlyHeading: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
  modePill: {
    alignSelf: 'center',
  },
  fields: {
    gap: spacing.md,
  },
  // 앱처럼 둥글고 부드러운 입력칸 (테두리 대신 연한 채움색)
  field: {
    gap: spacing.xs,
  },
  input: {
    fontSize: 16,
  },
  actions: {
    gap: spacing.sm,
  },
  gradientWrap: {
    borderRadius: radius.pill,
    overflow: 'hidden',
    boxShadow: '0px 8px 20px rgba(8, 110, 175, 0.28)',
  },
  gradientHover: {
    boxShadow: '0px 10px 24px rgba(8, 110, 175, 0.36)',
  },
  gradientPressed: {
    opacity: 0.92,
  },
  gradient: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  pillButton: {
    borderRadius: radius.pill,
  },
  helpRow: {
    alignItems: 'center',
    marginTop: -spacing.md,
    marginBottom: -spacing.sm,
  },
});
