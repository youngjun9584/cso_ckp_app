/**
 * 회원가입(가입 신청) — 로그인과 같은 아이콘 중심의 간결한 화면.
 * 서버 POST /v1/auth/register 는 승인 대기(apr_yn='N')로 저장한다. 가입 직후 로그인되지 않는다(토큰 없음).
 * 관리자가 기존 관리자 화면(앱 회원 관리)에서 승인해야 로그인할 수 있다.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View, type TextInput } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, FormScroll, Icon, IconButton, ModeBanner, Text, TextField, confirm } from '@/components/ui';
import { webOnly } from '@/components/ui/web-props';
import { ApiError, getApi, getErrorMessage } from '@/lib/api';
import type { RegisterResponse } from '@/lib/api/contract';
import { useFeatures } from '@/lib/auth';
import { formatPhone } from '@/lib/format';
import { useBeforeUnloadWeb } from '@/lib/navigation-guard';
import { colors, radius, shadow, spacing, useIsWide } from '@/theme';
import { AuthBrandPanel } from './AuthBrandPanel';
import { FormBanner } from './FormBanner';
import { PrivacyConsent } from './PrivacyConsent';
import {
  EMPTY_SIGNUP_FORM,
  SIGNUP_LIMITS,
  SIGNUP_MESSAGES,
  firstSignupErrorField,
  hasSignupErrors,
  isSignupFormDirty,
  isSignupFormField,
  normalizeUsrId,
  toRegisterRequest,
  validateSignupForm,
  validateUsrId,
  type SignupFormErrors,
  type SignupFormField,
  type SignupFormValues,
} from './signup-validation';

const LEAVE_MESSAGE = '입력한 내용이 사라집니다.';
const DISABLED_MESSAGE = '현재 앱에서 회원가입을 받지 않습니다. 관리자에게 계정 발급을 요청해 주세요.';

type IdCheckStatus = 'idle' | 'checking' | 'available' | 'taken' | 'failed';
interface IdCheck {
  status: IdCheckStatus;
  id: string;
  message: string | null;
}
const IDLE_CHECK: IdCheck = { status: 'idle', id: '', message: null };

type NavigationAction = Parameters<Parameters<typeof usePreventRemove>[1]>[0]['data']['action'];

export function SignupScreen() {
  const features = useFeatures();
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const api = getApi();

  const [values, setValues] = useState<SignupFormValues>(EMPTY_SIGNUP_FORM);
  const [errors, setErrors] = useState<SignupFormErrors>({});
  const [idCheck, setIdCheck] = useState<IdCheck>(IDLE_CHECK);
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const [exitAction, setExitAction] = useState<NavigationAction | null>(null);

  const submittingRef = useRef(false);
  const idSeq = useRef(0);
  const inputs = useRef<Partial<Record<SignupFormField, TextInput | null>>>({});

  const disabled = features.selfRegistration === false;
  const guardActive = !result && !disabled && exitAction === null && (isSignupFormDirty(values) || submitting);

  // 뒤로가기(헤더·Android 뒤로 버튼) 시 입력 내용 확인
  usePreventRemove(guardActive, ({ data }) => {
    void confirm({
      title: '회원가입을 그만둘까요?',
      message: LEAVE_MESSAGE,
      confirmText: '나가기',
      cancelText: '계속 작성',
      tone: 'danger',
    }).then((ok) => {
      if (ok) setExitAction(data.action);
    });
  });
  useBeforeUnloadWeb(guardActive ? LEAVE_MESSAGE : null);

  // 가드를 먼저 푼 뒤(렌더 반영) 원래 동작을 한 번만 실행한다
  const handledExit = useRef<NavigationAction | null>(null);
  useEffect(() => {
    if (!exitAction || handledExit.current === exitAction) return;
    handledExit.current = exitAction;
    navigation.dispatch(exitAction);
  }, [exitAction, navigation]);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/login');
  }

  function update(field: SignupFormField, value: string | boolean) {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
    if (field === 'usrId') {
      idSeq.current += 1; // 진행 중인 확인 결과는 버린다
      setIdCheck(IDLE_CHECK);
    }
    if (field === 'password' && errors.passwordConfirm) setErrors((e) => ({ ...e, passwordConfirm: undefined }));
    if (banner) setBanner(null);
  }

  /** 아이디 중복 확인. true=사용 가능, false=사용 불가(형식·중복), null=확인하지 못함(네트워크 등) */
  async function checkId(): Promise<boolean | null> {
    const id = normalizeUsrId(values.usrId);
    const formatError = validateUsrId(id);
    if (formatError) {
      setErrors((e) => ({ ...e, usrId: formatError }));
      setIdCheck(IDLE_CHECK);
      return false;
    }
    if (idCheck.id === id && idCheck.status === 'available') return true;
    if (idCheck.id === id && idCheck.status === 'taken') return false;

    const seq = ++idSeq.current;
    setIdCheck({ status: 'checking', id, message: null });
    try {
      const res = await api.checkUserId(id);
      if (seq !== idSeq.current) return null;
      if (res.available) {
        setIdCheck({ status: 'available', id, message: res.message || SIGNUP_MESSAGES.usrIdAvailable });
        return true;
      }
      const message = res.message || SIGNUP_MESSAGES.usrIdDuplicate;
      setIdCheck({ status: 'taken', id, message });
      setErrors((e) => ({ ...e, usrId: message }));
      return false;
    } catch (error) {
      if (seq !== idSeq.current) return null;
      if (error instanceof ApiError && error.fields.usrId) {
        setIdCheck(IDLE_CHECK);
        setErrors((e) => ({ ...e, usrId: error.fields.usrId }));
        return false;
      }
      setIdCheck({ status: 'failed', id, message: getErrorMessage(error) });
      return null;
    }
  }

  function focusFirstError(next: SignupFormErrors) {
    const first = firstSignupErrorField(next);
    if (first) inputs.current[first]?.focus();
  }

  async function submit() {
    if (submittingRef.current || disabled) return;
    setBanner(null);
    const next = validateSignupForm(values);
    if (hasSignupErrors(next)) {
      setErrors(next);
      focusFirstError(next);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const available = await checkId();
      if (available === false) {
        inputs.current.usrId?.focus();
        return;
      }
      const res = await api.register(toRegisterRequest(values));
      setResult(res);
    } catch (error) {
      if (error instanceof ApiError) {
        const mapped: SignupFormErrors = {};
        for (const [key, message] of Object.entries(error.fields)) {
          if (isSignupFormField(key)) mapped[key] = message;
        }
        if (error.code === 'DUPLICATE_USER_ID') {
          const message = mapped.usrId ?? SIGNUP_MESSAGES.usrIdDuplicate;
          mapped.usrId = message;
          setIdCheck({ status: 'taken', id: normalizeUsrId(values.usrId), message });
        }
        if (hasSignupErrors(mapped)) {
          setErrors((e) => ({ ...e, ...mapped }));
          focusFirstError(mapped);
        } else {
          setBanner(error.code === 'REGISTRATION_DISABLED' ? DISABLED_MESSAGE : error.message);
        }
      } else {
        setBanner(getErrorMessage(error));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // ── 화면 조각 ──

  const header = (
    <View style={styles.headerRow}>
      <IconButton icon="arrow-back" accessibilityLabel="로그인 화면으로 돌아가기" onPress={goBack} />
      <Text variant="heading" role="heading" style={styles.headerTitle} {...webOnly({ 'aria-level': 1 })}>
        회원가입
      </Text>
      <ModeBanner variant="pill" />
    </View>
  );

  const idRight = (
    <Button
      title="중복 확인"
      size="sm"
      variant="soft"
      labelVariant="label"
      loading={idCheck.status === 'checking'}
      disabled={submitting}
      onPress={() => void checkId()}
      accessibilityLabel="아이디 중복 확인"
    />
  );

  const idSuccess =
    idCheck.status === 'available' && idCheck.id === normalizeUsrId(values.usrId) ? idCheck.message : null;
  const idHelper = idCheck.status === 'failed' ? `중복 확인을 하지 못했습니다. ${idCheck.message ?? ''}`.trim() : undefined;

  const fields = (
    <View style={styles.fields}>
      <TextField
        ref={(r) => {
          inputs.current.usrId = r;
        }}
        label="아이디"
        required
        placeholder="2~20자"
        leftIcon="person-outline"
        leftIconColor={colors.primary}
        value={values.usrId}
        onChangeText={(t) => update('usrId', t)}
        onBlur={() => {
          if (normalizeUsrId(values.usrId)) void checkId();
        }}
        error={errors.usrId}
        success={idSuccess}
        helper={idHelper}
        right={idRight}
        maxLength={SIGNUP_LIMITS.usrIdMax + 4}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="username"
        editable={!submitting}
        returnKeyType="next"
        onSubmitEditing={() => inputs.current.password?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={(r) => {
          inputs.current.password = r;
        }}
        label="비밀번호"
        required
        placeholder="영문·숫자 8자 이상"
        leftIcon="lock-closed-outline"
        leftIconColor={colors.primary}
        secureToggle
        value={values.password}
        onChangeText={(t) => update('password', t)}
        error={errors.password}
        helper={SIGNUP_MESSAGES.passwordHint}
        maxLength={SIGNUP_LIMITS.passwordMax}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!submitting}
        returnKeyType="next"
        onSubmitEditing={() => inputs.current.passwordConfirm?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={(r) => {
          inputs.current.passwordConfirm = r;
        }}
        label="비밀번호 확인"
        required
        placeholder="비밀번호 다시 입력"
        leftIcon="shield-checkmark-outline"
        leftIconColor={colors.primary}
        secureToggle
        value={values.passwordConfirm}
        onChangeText={(t) => update('passwordConfirm', t)}
        error={errors.passwordConfirm}
        maxLength={SIGNUP_LIMITS.passwordMax}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!submitting}
        returnKeyType="next"
        onSubmitEditing={() => inputs.current.name?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={(r) => {
          inputs.current.name = r;
        }}
        label="이름"
        required
        placeholder="이름"
        leftIcon="id-card-outline"
        leftIconColor={colors.primary}
        value={values.name}
        onChangeText={(t) => update('name', t)}
        error={errors.name}
        maxLength={SIGNUP_LIMITS.nameMax}
        autoComplete="name"
        textContentType="name"
        editable={!submitting}
        returnKeyType="next"
        onSubmitEditing={() => inputs.current.phone?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={(r) => {
          inputs.current.phone = r;
        }}
        label="휴대폰"
        required
        placeholder="010-0000-0000"
        leftIcon="call-outline"
        leftIconColor={colors.primary}
        value={values.phone}
        onChangeText={(t) => update('phone', formatPhone(t))}
        error={errors.phone}
        maxLength={SIGNUP_LIMITS.phoneMax}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        editable={!submitting}
        returnKeyType="next"
        onSubmitEditing={() => inputs.current.email?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={(r) => {
          inputs.current.email = r;
        }}
        label="이메일 (선택)"
        placeholder="name@example.com"
        leftIcon="mail-outline"
        leftIconColor={colors.primary}
        value={values.email}
        onChangeText={(t) => update('email', t)}
        error={errors.email}
        maxLength={SIGNUP_LIMITS.emailMax}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        editable={!submitting}
        returnKeyType="next"
        onSubmitEditing={() => inputs.current.companyName?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={(r) => {
          inputs.current.companyName = r;
        }}
        label="회사명 (선택)"
        placeholder="회사명"
        leftIcon="business-outline"
        leftIconColor={colors.primary}
        value={values.companyName}
        onChangeText={(t) => update('companyName', t)}
        error={errors.companyName}
        maxLength={SIGNUP_LIMITS.companyNameMax}
        autoComplete="organization"
        textContentType="organizationName"
        editable={!submitting}
        returnKeyType="done"
      />
      <PrivacyConsent
        checked={values.agreePrivacy}
        onChange={(checked) => update('agreePrivacy', checked)}
        error={errors.agreePrivacy}
        disabled={submitting}
      />
      {banner ? <FormBanner tone="danger" message={banner} live /> : null}
    </View>
  );

  const submitButton = (
    <Button
      title={submitting ? '신청 중…' : '가입 신청'}
      icon="paper-plane-outline"
      size="lg"
      labelVariant="button"
      fullWidth
      loading={submitting}
      onPress={() => void submit()}
    />
  );

  // ── 상태별 본문 ──

  let body: ReactNode;
  if (result) {
    body = (
      <View style={styles.centerBlock} accessibilityLiveRegion="polite">
        <View style={[styles.stateIcon, { backgroundColor: colors.successSoft }]}>
          <Icon name="checkmark-circle" size={40} color={colors.success} />
        </View>
        <Text variant="heading" align="center" role="heading">
          가입 신청 완료
        </Text>
        <Text variant="secondary" tone="secondary" align="center">
          관리자 승인 후 로그인할 수 있습니다.
        </Text>
        <View style={styles.idChip}>
          <Icon name="person-outline" size={16} color={colors.primary} />
          <Text variant="label">{result.usrId}</Text>
        </View>
        <Button
          title="로그인 화면으로"
          icon="log-in-outline"
          size="lg"
          labelVariant="button"
          fullWidth
          onPress={() => router.replace({ pathname: '/login', params: { usrId: result.usrId } })}
        />
      </View>
    );
  } else if (disabled) {
    body = (
      <View style={styles.centerBlock}>
        <View style={[styles.stateIcon, { backgroundColor: colors.warningSoft }]}>
          <Icon name="lock-closed-outline" size={36} color={colors.warning} />
        </View>
        <Text variant="secondary" tone="secondary" align="center">
          {DISABLED_MESSAGE}
        </Text>
        <Button title="로그인 화면으로" icon="arrow-back" variant="secondary" size="lg" labelVariant="button" fullWidth onPress={goBack} />
      </View>
    );
  }

  // ── 넓은 웹 화면: 왼쪽 로고 패널 + 오른쪽 카드 ──
  if (wide) {
    return (
      <View style={styles.wideRoot}>
        <StatusBar style="light" />
        <AuthBrandPanel caption="가입 신청 후 관리자 승인이 필요합니다" />
        <ScrollView style={styles.flex} contentContainerStyle={styles.wideWrap} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            {header}
            {body ?? (
              <>
                {fields}
                {submitButton}
              </>
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── 휴대폰: 상단 바 + 폼 + 하단 고정 버튼 ──
  return (
    <View style={styles.mobileRoot}>
      <StatusBar style="dark" />
      <View style={[styles.mobileHeader, { paddingTop: insets.top + spacing.xs }]}>{header}</View>
      {body ? (
        <KeyboardAvoidingView style={styles.flex} enabled={false}>
          <ScrollView contentContainerStyle={styles.mobileStateWrap}>{body}</ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <FormScroll footer={submitButton} footerSafeArea maxWidth={560}>
          {fields}
        </FormScroll>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginLeft: -spacing.sm,
  },
  headerTitle: {
    flex: 1,
  },
  fields: {
    gap: spacing.lg,
  },
  // 넓은 화면
  wideRoot: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.bg,
  },
  wideWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxxl,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.card,
    borderRadius: radius.card + 4,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
    gap: spacing.lg,
    ...shadow.raised,
  },
  // 휴대폰
  mobileRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  mobileHeader: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mobileStateWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  // 완료·꺼짐 안내
  centerBlock: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  stateIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  idChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    marginBottom: spacing.sm,
  },
});
