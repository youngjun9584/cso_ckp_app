/**
 * 거래처 등록 (DESIGN §2.2, §6.5)
 * - 입력 검증은 서버와 같은 규칙(../validation), 서버 오류(error.fields)는 해당 입력란 아래에 표시
 * - 사업자등록번호: 자동 하이픈 → 입력란을 벗어나면 10자리·검증번호 확인 후 중복 확인
 * - 저장 버튼은 하단 고정(FormScroll), 저장 중 비활성 + 중복 탭 방지
 * - 입력 중 뒤로가기/목록으로 돌아가기 → 확인 대화상자, 웹 새로고침·닫기 → 브라우저 확인
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, View, type ScrollView, type TextInput } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useQueryClient } from '@tanstack/react-query';

import { AppHeader, Button, Card, FormScroll, Icon, Screen, Text, TextField, confirm, toast } from '@/components/ui';
import { ApiError, getApi, getErrorMessage } from '@/lib/api';
import { useFeatures } from '@/lib/auth';
import { formatBizNo, formatPhone, onlyDigits } from '@/lib/format';
import { useBeforeUnloadWeb } from '@/lib/navigation-guard';
import { colors, layout, spacing } from '@/theme';
import { ClientTypeField } from '../ClientTypeField';
import { Notice } from '../Notice';
import { clientKeys } from '../queries';
import {
  CLIENT_FIELD_LIMITS,
  CLIENT_MESSAGES,
  EMPTY_CLIENT_FORM,
  firstErrorField,
  hasErrors,
  isClientFormDirty,
  isClientFormField,
  joinAddress,
  normalizeClientName,
  toClientCreateRequest,
  validateBizNoInput,
  validateClientForm,
  type ClientFormErrors,
  type ClientFormField,
  type ClientFormValues,
} from '../validation';

type CheckStatus = 'idle' | 'checking' | 'ok' | 'duplicate' | 'invalid' | 'failed';

interface DuplicateCheck {
  status: CheckStatus;
  /** 확인한 값 (사업자번호는 숫자만, 이름은 정규화한 값) */
  key: string;
  message?: string;
}

const IDLE_CHECK: DuplicateCheck = { status: 'idle', key: '' };

/** usePreventRemove 가 넘겨주는 내비게이션 동작 */
type NavigationAction = Parameters<Parameters<typeof usePreventRemove>[1]>[0]['data']['action'];

type ExitIntent = { kind: 'leave'; action: NavigationAction } | { kind: 'created'; idx: number };

type SectionId = 'basic' | 'address' | 'extra';

const FIELD_SECTION: Record<ClientFormField, SectionId> = {
  name: 'basic',
  clientType: 'basic',
  bizNo: 'basic',
  representative: 'basic',
  phone: 'basic',
  zipCode: 'address',
  address: 'address',
  addressDetail: 'address',
  careCode: 'extra',
  dispensary: 'extra',
  memo: 'extra',
};

interface Banner {
  message: string;
  /** 이미 등록된 같은 거래처 (409 details.existingIdx) */
  existingIdx?: number;
}

const LEAVE_MESSAGE = '입력한 거래처 정보는 저장되지 않습니다.';

export function ClientCreateScreen() {
  const api = getApi();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const features = useFeatures();
  const clientTypeField = features.clientTypeField;

  const [values, setValues] = useState<ClientFormValues>(EMPTY_CLIENT_FORM);
  const [errors, setErrors] = useState<ClientFormErrors>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [saving, setSaving] = useState(false);
  const [bizCheck, setBizCheck] = useState<DuplicateCheck>(IDLE_CHECK);
  const [nameCheck, setNameCheck] = useState<DuplicateCheck>(IDLE_CHECK);
  const [exit, setExit] = useState<ExitIntent | null>(null);

  const savingRef = useRef(false);
  const bizSeq = useRef(0);
  const nameSeq = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const inputs = useRef<Partial<Record<ClientFormField, TextInput | null>>>({});
  const sectionY = useRef<Partial<Record<SectionId, number>>>({});
  const fieldY = useRef<Partial<Record<ClientFormField, number>>>({});

  const dirty = isClientFormDirty(values);
  const guardActive = dirty && exit === null;

  // 같은 스택 안 뒤로가기(헤더·Android 뒤로 버튼·탭 다시 누르기)
  usePreventRemove(guardActive, ({ data }) => {
    void confirm({
      title: '거래처 등록을 그만둘까요?',
      message: LEAVE_MESSAGE,
      confirmText: '나가기',
      cancelText: '계속 작성',
      tone: 'danger',
    }).then((ok) => {
      if (ok) setExit({ kind: 'leave', action: data.action });
    });
  });
  useBeforeUnloadWeb(guardActive ? LEAVE_MESSAGE : null);

  // 가드를 먼저 푼(렌더 반영) 뒤 이동해야 같은 동작이 다시 막히지 않는다. 한 번만 실행한다.
  const handledExit = useRef<ExitIntent | null>(null);
  useEffect(() => {
    if (!exit || handledExit.current === exit) return;
    handledExit.current = exit;
    if (exit.kind === 'created') router.replace({ pathname: '/clients/[idx]', params: { idx: String(exit.idx) } });
    else navigation.dispatch(exit.action);
  }, [exit, navigation]);

  // ── 입력 ──

  function update(patch: Partial<ClientFormValues>, clear: ClientFormField[]) {
    setValues((v) => ({ ...v, ...patch }));
    if (clear.some((f) => errors[f])) {
      setErrors((e) => {
        const next = { ...e };
        for (const f of clear) delete next[f];
        return next;
      });
    }
  }

  function setField(field: ClientFormField, value: string) {
    // 주소·상세주소는 합계 길이 오류를 같이 쓰므로 함께 지운다
    const clear: ClientFormField[] = field === 'address' || field === 'addressDetail' ? ['address', 'addressDetail'] : [field];
    update({ [field]: value }, clear);
  }

  function onNameChange(text: string) {
    nameSeq.current += 1;
    setNameCheck(IDLE_CHECK);
    setField('name', text);
  }

  function onBizNoChange(text: string) {
    bizSeq.current += 1;
    setBizCheck(IDLE_CHECK);
    setField('bizNo', formatBizNo(text));
  }

  async function checkName() {
    const name = normalizeClientName(values.name);
    if (!name || name.length > CLIENT_FIELD_LIMITS.name) return;
    if (nameCheck.key === name && nameCheck.status !== 'idle' && nameCheck.status !== 'failed') return;
    nameSeq.current += 1;
    const seq = nameSeq.current;
    setNameCheck({ status: 'checking', key: name });
    try {
      const res = await api.checkClientDuplicate({ name });
      if (seq !== nameSeq.current) return;
      if (res.name.checked && res.name.duplicate) {
        const message = res.name.message ?? CLIENT_MESSAGES.nameDuplicate;
        setNameCheck({ status: 'duplicate', key: name, message });
        setErrors((e) => ({ ...e, name: message }));
      } else {
        setNameCheck({ status: 'ok', key: name });
      }
    } catch {
      // 확인하지 못해도 저장할 때 서버가 다시 확인한다
      if (seq === nameSeq.current) setNameCheck({ status: 'failed', key: name });
    }
  }

  async function checkBizNo() {
    const raw = values.bizNo.trim();
    if (!raw) return;
    const localError = validateBizNoInput(raw);
    if (localError) {
      setErrors((e) => ({ ...e, bizNo: localError }));
      return;
    }
    const digits = onlyDigits(raw);
    if (bizCheck.key === digits && bizCheck.status !== 'idle' && bizCheck.status !== 'failed') return;
    bizSeq.current += 1;
    const seq = bizSeq.current;
    setBizCheck({ status: 'checking', key: digits });
    try {
      const res = await api.checkClientDuplicate({ bizNo: digits });
      if (seq !== bizSeq.current) return;
      const r = res.bizNo;
      if (r.checked && (r.duplicate || !r.valid)) {
        const message = r.message ?? (r.duplicate ? CLIENT_MESSAGES.bizNoDuplicate : CLIENT_MESSAGES.bizNoChecksum);
        setBizCheck({ status: r.duplicate ? 'duplicate' : 'invalid', key: digits, message });
        setErrors((e) => ({ ...e, bizNo: message }));
      } else {
        setBizCheck({ status: r.checked ? 'ok' : 'idle', key: digits });
      }
    } catch {
      if (seq === bizSeq.current) setBizCheck({ status: 'failed', key: digits });
    }
  }

  // ── 오류 위치로 이동 ──

  function scrollToField(field: ClientFormField) {
    const y = (sectionY.current[FIELD_SECTION[field]] ?? 0) + (fieldY.current[field] ?? 0);
    scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true });
    inputs.current[field]?.focus();
  }

  function focusNext(field: ClientFormField) {
    inputs.current[field]?.focus();
  }

  function showErrors(next: ClientFormErrors) {
    setErrors(next);
    const first = firstErrorField(next);
    if (first) scrollToField(first);
  }

  // ── 저장 ──

  async function submit() {
    if (savingRef.current) return;
    Keyboard.dismiss();

    const next = validateClientForm(values, { clientTypeField });
    const digits = onlyDigits(values.bizNo);
    if (!next.bizNo && (bizCheck.status === 'duplicate' || bizCheck.status === 'invalid') && bizCheck.key === digits) {
      next.bizNo = bizCheck.message;
    }
    if (!next.name && nameCheck.status === 'duplicate' && nameCheck.key === normalizeClientName(values.name)) {
      next.name = nameCheck.message;
    }
    if (hasErrors(next)) {
      setBanner(null);
      showErrors(next);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setBanner(null);
    setErrors({});
    try {
      const { client } = await api.createClient(toClientCreateRequest(values, { clientTypeField }));
      queryClient.setQueryData(clientKeys.detail(client.idx), { client });
      void queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
      toast.success(
        client.approval === 'pending' && !client.selectableForEdi
          ? '거래처가 등록되었습니다. 관리자 승인 후 EDI 등록에 사용할 수 있습니다.'
          : '거래처가 등록되었습니다.',
      );
      setExit({ kind: 'created', idx: client.idx });
    } catch (error) {
      savingRef.current = false;
      setSaving(false);
      handleSaveError(error);
    }
  }

  function handleSaveError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setBanner({ message: getErrorMessage(error) });
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    const fieldErrors: ClientFormErrors = {};
    const unmatched: string[] = [];
    for (const [key, message] of Object.entries(error.fields)) {
      if (isClientFormField(key) && (key !== 'clientType' || clientTypeField)) fieldErrors[key] = message;
      else unmatched.push(message);
    }
    const rawExisting = error.details.existingIdx;
    const existingIdx = typeof rawExisting === 'number' && Number.isInteger(rawExisting) ? rawExisting : undefined;

    if (error.code === 'DUPLICATE_BIZ_NO' && fieldErrors.bizNo) {
      setBizCheck({ status: 'duplicate', key: onlyDigits(values.bizNo), message: fieldErrors.bizNo });
    }
    if (error.code === 'DUPLICATE_CLIENT_NAME' && fieldErrors.name) {
      setNameCheck({ status: 'duplicate', key: normalizeClientName(values.name), message: fieldErrors.name });
    }

    if (hasErrors(fieldErrors)) {
      setBanner(unmatched.length || existingIdx ? { message: unmatched.length ? unmatched.join('\n') : error.message, existingIdx } : null);
      showErrors(fieldErrors);
    } else {
      setBanner({ message: error.message, existingIdx });
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }

  // ── 표시 ──

  const addressLength = joinAddress(values.address, values.addressDetail).length;
  // 합계 길이 오류는 서버가 두 칸 모두에 준다 → 상세주소가 있으면 상세주소 아래에만 표시
  const addressError =
    errors.address && errors.address === errors.addressDetail && values.addressDetail.trim() ? null : errors.address;

  const bizRight =
    bizCheck.status === 'checking' ? (
      <ActivityIndicator size="small" color={colors.textMuted} />
    ) : bizCheck.status === 'ok' && !errors.bizNo ? (
      <Icon name="checkmark-circle" size={20} color={colors.success} />
    ) : null;
  const bizHelper =
    bizCheck.status === 'checking'
      ? '중복 여부를 확인하고 있습니다…'
      : bizCheck.status === 'ok'
        ? '사용할 수 있는 사업자등록번호입니다.'
        : bizCheck.status === 'failed'
          ? '중복 여부를 확인하지 못했습니다. 등록할 때 다시 확인합니다.'
          : '숫자 10자리 (예: 123-45-67890)';

  const field = (name: ClientFormField, child: ReactNode) => (
    <View
      key={name}
      onLayout={(e) => {
        fieldY.current[name] = e.nativeEvent.layout.y;
      }}
    >
      {child}
    </View>
  );

  return (
    <Screen header={<AppHeader title="거래처 등록" back backHref="/clients" maxWidth={layout.formMaxWidth} />} padded={false} maxWidth={null}>
      <FormScroll
        scrollRef={scrollRef}
        footer={<Button title="거래처 등록" icon="checkmark" size="lg" fullWidth loading={saving} onPress={() => void submit()} />}
      >
        {features.clientApprovalRequiredForEdi ? (
          <Notice tone="info" message="등록한 거래처는 관리자 승인 후 EDI 등록에 사용할 수 있습니다." />
        ) : null}

        {banner ? (
          <Notice tone="danger" title="등록하지 못했습니다" message={banner.message} live>
            {banner.existingIdx ? (
              <Button
                title="등록된 거래처 보기"
                variant="secondary"
                size="sm"
                iconRight="chevron-forward"
                onPress={() => router.push({ pathname: '/clients/[idx]', params: { idx: String(banner.existingIdx) } })}
              />
            ) : null}
          </Notice>
        ) : null}

        <Text variant="caption" tone="secondary">
          <Text variant="caption" tone="danger">
            *
          </Text>{' '}
          표시는 필수 입력 항목입니다.
        </Text>

        <Section
          id="basic"
          title="기본 정보"
          onY={(y) => {
            sectionY.current.basic = y;
          }}
        >
          {field(
            'name',
            <TextField
              ref={(el) => {
                inputs.current.name = el;
              }}
              label="거래처명"
              required
              value={values.name}
              onChangeText={onNameChange}
              onBlur={() => void checkName()}
              error={errors.name}
              helper={nameCheck.status === 'checking' ? '같은 이름이 있는지 확인하고 있습니다…' : undefined}
              placeholder="예: 서울바른내과의원"
              maxLength={CLIENT_FIELD_LIMITS.name}
              editable={!saving}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusNext('bizNo')}
            />,
          )}
          {clientTypeField
            ? field(
                'clientType',
                <ClientTypeField
                  value={values.clientType}
                  onChange={(v) => setField('clientType', v)}
                  error={errors.clientType}
                  disabled={saving}
                  inputRef={(el) => {
                    inputs.current.clientType = el;
                  }}
                />,
              )
            : null}
          {field(
            'bizNo',
            <TextField
              ref={(el) => {
                inputs.current.bizNo = el;
              }}
              label="사업자등록번호"
              value={values.bizNo}
              onChangeText={onBizNoChange}
              onBlur={() => void checkBizNo()}
              error={errors.bizNo}
              helper={bizHelper}
              right={bizRight}
              placeholder="000-00-00000"
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={12}
              editable={!saving}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusNext('representative')}
            />,
          )}
          {field(
            'representative',
            <TextField
              ref={(el) => {
                inputs.current.representative = el;
              }}
              label="대표자명"
              value={values.representative}
              onChangeText={(t) => setField('representative', t)}
              error={errors.representative}
              placeholder="원장님 또는 대표자 이름"
              maxLength={CLIENT_FIELD_LIMITS.representative}
              editable={!saving}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusNext('phone')}
            />,
          )}
          {field(
            'phone',
            <TextField
              ref={(el) => {
                inputs.current.phone = el;
              }}
              label="연락처"
              value={values.phone}
              onChangeText={(t) => setField('phone', formatPhone(t))}
              error={errors.phone}
              placeholder="예: 02-1234-5678"
              keyboardType="phone-pad"
              inputMode="tel"
              autoComplete="off"
              maxLength={13}
              editable={!saving}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusNext('zipCode')}
            />,
          )}
        </Section>

        <Section
          id="address"
          title="주소"
          onY={(y) => {
            sectionY.current.address = y;
          }}
        >
          {field(
            'zipCode',
            <TextField
              ref={(el) => {
                inputs.current.zipCode = el;
              }}
              label="우편번호"
              value={values.zipCode}
              onChangeText={(t) => setField('zipCode', t.replace(/[^\d-]/g, ''))}
              error={errors.zipCode}
              placeholder="예: 06236"
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={7}
              editable={!saving}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusNext('address')}
              containerStyle={styles.zip}
            />,
          )}
          {field(
            'address',
            <TextField
              ref={(el) => {
                inputs.current.address = el;
              }}
              label="주소"
              value={values.address}
              onChangeText={(t) => setField('address', t)}
              error={addressError}
              placeholder="도로명 또는 지번 주소"
              maxLength={CLIENT_FIELD_LIMITS.address}
              editable={!saving}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusNext('addressDetail')}
            />,
          )}
          {field(
            'addressDetail',
            <TextField
              ref={(el) => {
                inputs.current.addressDetail = el;
              }}
              label="상세주소"
              value={values.addressDetail}
              onChangeText={(t) => setField('addressDetail', t)}
              error={errors.addressDetail}
              helper={
                addressLength > 70
                  ? `주소와 상세주소를 합쳐 ${addressLength}/${CLIENT_FIELD_LIMITS.address}자`
                  : `주소와 합쳐 ${CLIENT_FIELD_LIMITS.address}자까지 저장됩니다.`
              }
              placeholder="건물명, 층, 호수 등"
              maxLength={CLIENT_FIELD_LIMITS.address}
              editable={!saving}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusNext('careCode')}
            />,
          )}
        </Section>

        <Section
          id="extra"
          title="추가 정보"
          onY={(y) => {
            sectionY.current.extra = y;
          }}
        >
          {field(
            'careCode',
            <TextField
              ref={(el) => {
                inputs.current.careCode = el;
              }}
              label="요양기관번호"
              value={values.careCode}
              onChangeText={(t) => setField('careCode', t)}
              error={errors.careCode}
              placeholder="예: 11358001"
              maxLength={CLIENT_FIELD_LIMITS.careCode}
              autoCapitalize="none"
              editable={!saving}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusNext('dispensary')}
            />,
          )}
          {field(
            'dispensary',
            <TextField
              ref={(el) => {
                inputs.current.dispensary = el;
              }}
              label="문전약국"
              value={values.dispensary}
              onChangeText={(t) => setField('dispensary', t)}
              error={errors.dispensary}
              placeholder="거래처 앞 약국 이름"
              maxLength={CLIENT_FIELD_LIMITS.dispensary}
              editable={!saving}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusNext('memo')}
            />,
          )}
          {field(
            'memo',
            <TextField
              ref={(el) => {
                inputs.current.memo = el;
              }}
              label="메모"
              value={values.memo}
              onChangeText={(t) => setField('memo', t)}
              error={errors.memo}
              placeholder="방문 요일, 담당 직원 등"
              multiline
              showCounter
              maxLength={CLIENT_FIELD_LIMITS.memo}
              editable={!saving}
            />,
          )}
        </Section>
      </FormScroll>
    </Screen>
  );
}

interface SectionProps {
  id: SectionId;
  title: string;
  onY: (y: number) => void;
  children: ReactNode;
}

function Section({ id, title, onY, children }: SectionProps) {
  return (
    <Card style={styles.section} onLayout={(e) => onY(e.nativeEvent.layout.y)} nativeID={`client-form-${id}`}>
      <Text variant="heading" role="heading">
        {title}
      </Text>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.lg,
  },
  zip: {
    maxWidth: 240,
  },
});
