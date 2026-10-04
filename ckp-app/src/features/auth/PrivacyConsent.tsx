/**
 * 회원가입 개인정보 수집·이용 동의 (필수 체크 + 펼쳐 보는 안내문).
 * - 체크 상자: role="checkbox" + aria-checked(웹은 DOM 속성, 네이티브는 접근성 상태), 웹 Space 키로도 전환
 * - 동의하지 않고 가입 신청하면 아래에 오류(스크린리더 알림)
 */
import { useId, useState, type Ref } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Card, Icon, Text } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import { webOnly } from '@/components/ui/web-props';
import { colors, focusRing, radius, spacing } from '@/theme';

/**
 * 안내 문구 — 회사(개인정보 보호 담당)가 최종 문구를 확인해야 한다.
 * 실제로 저장하는 항목(아이디·비밀번호(암호화)·이름·휴대폰·이메일·회사명)과 어긋나지 않게 함께 고친다.
 */
export const PRIVACY_CONSENT_LABEL = '[필수] 개인정보 수집·이용에 동의합니다';
export const PRIVACY_CONSENT_DETAILS: readonly { title: string; body: string }[] = [
  { title: '수집 항목', body: '아이디, 이름, 휴대폰, 이메일, 회사명' },
  { title: '목적', body: '회원 식별, 가입 승인, 업무 연락' },
  { title: '보유 기간', body: '회원 탈퇴 시까지' },
];
export const PRIVACY_CONSENT_NOTE = '동의하지 않으면 회원가입을 신청할 수 없습니다.';

export interface PrivacyConsentProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
  disabled?: boolean;
  ref?: Ref<View>;
}

export function PrivacyConsent({ checked, onChange, error, disabled, ref }: PrivacyConsentProps) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const errorId = useId();
  const hasError = !!error;
  const toggle = () => {
    if (!disabled) onChange(!checked);
  };

  // RN-web Pressable 은 role="checkbox" 에서 Enter 만 누름으로 처리하므로 Space 도 받는다
  const webKeyProps =
    Platform.OS === 'web'
      ? ({
          onKeyDown: (e: { key?: string; preventDefault?: () => void }) => {
            if (e.key === ' ' || e.key === 'Spacebar') {
              e.preventDefault?.();
              toggle();
            }
          },
        } as object)
      : null;

  return (
    <Card style={[styles.card, hasError && styles.cardError]}>
      <Pressable
        ref={ref}
        onPress={toggle}
        disabled={disabled}
        role="checkbox"
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: !!disabled }}
        aria-checked={checked}
        accessibilityLabel={PRIVACY_CONSENT_LABEL}
        accessibilityHint={error ?? undefined}
        {...webOnly({
          'aria-required': true,
          'aria-invalid': hasError || undefined,
          'aria-describedby': hasError ? errorId : undefined,
        })}
        {...webKeyProps}
        hitSlop={4}
        style={(state) => {
          const { hovered, focused, pressed } = asInteraction(state);
          return [styles.row, (hovered || pressed) && styles.rowHover, focused && styles.rowFocus];
        }}
      >
        <View
          style={[
            styles.box,
            checked ? styles.boxChecked : null,
            hasError && !checked ? styles.boxError : null,
            disabled ? styles.boxDisabled : null,
          ]}
        >
          {checked ? <Icon name="checkmark" size={18} color={colors.white} /> : null}
        </View>
        <Text variant="bodyStrong" style={styles.label}>
          <Text variant="bodyStrong" tone="danger">
            [필수]
          </Text>{' '}
          개인정보 수집·이용에 동의합니다
        </Text>
      </Pressable>

      <Pressable
        onPress={() => setExpanded((v) => !v)}
        role="button"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        accessibilityLabel={expanded ? '개인정보 수집·이용 안내 접기' : '개인정보 수집·이용 안내 자세히 보기'}
        {...webOnly({ 'aria-controls': detailsId })}
        hitSlop={6}
        style={(state) => {
          const { hovered, focused } = asInteraction(state);
          return [styles.moreButton, hovered && styles.moreHover, focused && styles.rowFocus];
        }}
      >
        <Text variant="label" tone="primary">
          {expanded ? '접기' : '자세히 보기'}
        </Text>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
      </Pressable>

      {expanded ? (
        <View style={styles.details} nativeID={detailsId}>
          {PRIVACY_CONSENT_DETAILS.map((item) => (
            <View key={item.title} style={styles.detailRow}>
              <Text variant="secondary" weight="semibold" style={styles.detailTitle}>
                {item.title}
              </Text>
              <Text variant="secondary" tone="secondary" style={styles.detailBody}>
                {item.body}
              </Text>
            </View>
          ))}
          <Text variant="caption" tone="muted">
            {PRIVACY_CONSENT_NOTE}
          </Text>
        </View>
      ) : null}

      {hasError ? (
        <View style={styles.errorRow} nativeID={errorId} accessibilityLiveRegion="polite" role="alert">
          <Icon name="alert-circle" size={16} color={colors.danger} />
          <Text variant="secondary" tone="danger" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  cardError: {
    borderColor: colors.danger,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    borderRadius: radius.sm,
    marginHorizontal: -spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  rowHover: {
    backgroundColor: '#F6F8FB',
  },
  rowFocus: {
    ...focusRing,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: '#AEBBCB',
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  boxError: {
    borderColor: colors.danger,
  },
  boxDisabled: {
    opacity: 0.6,
  },
  label: {
    flex: 1,
  },
  moreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.xs,
    marginLeft: 24 + spacing.md - spacing.xs,
    borderRadius: radius.sm,
  },
  moreHover: {
    backgroundColor: colors.primarySoft,
  },
  details: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.bg,
  },
  detailRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  detailTitle: {
    width: 64,
  },
  detailBody: {
    flex: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  flex: {
    flex: 1,
  },
});
