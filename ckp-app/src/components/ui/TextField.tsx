import { useId, useState, type ReactNode, type Ref } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, controlHeight, focusRing, fontFamily, fontSize, radius, spacing } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { webOnly } from './web-props';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** 라벨 옆에 빨간 * 표시 */
  required?: boolean;
  /** 입력란 아래 도움말 (오류가 있으면 오류가 대신 보인다) */
  helper?: string;
  /** 입력란 아래 오류 메시지 (danger 색, 스크린리더 알림) */
  error?: string | null;
  /** 입력란 아래 확인 메시지 (success 색 + 체크 아이콘, 예: '사용할 수 있는 아이디입니다.'). 오류가 있으면 오류가 우선 */
  success?: string | null;
  /** maxLength 와 함께 '12/500' 글자 수 표시 */
  showCounter?: boolean;
  /** 비밀번호 보기/숨기기 버튼 (secureTextEntry 를 대신 관리) */
  secureToggle?: boolean;
  /** 입력란 왼쪽 아이콘 */
  leftIcon?: IconName;
  /** 왼쪽 아이콘 색 (기본 textMuted) */
  leftIconColor?: string;
  /** 입력란 오른쪽 요소 (버튼 등) */
  right?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  /** pill: 둥글고 연한 채움색의 앱 스타일 입력칸(로그인 등). 기본은 테두리형 */
  shape?: 'default' | 'pill';
  ref?: Ref<TextInput>;
}

export function TextField({
  label,
  required,
  helper,
  error,
  success,
  showCounter,
  secureToggle,
  leftIcon,
  leftIconColor,
  right,
  containerStyle,
  inputStyle,
  shape = 'default',
  editable = true,
  multiline,
  maxLength,
  value,
  secureTextEntry,
  onFocus,
  onBlur,
  accessibilityLabel,
  ref,
  ...rest
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const messageId = useId();
  const hasError = !!error;
  const successText = !hasError && success ? success : null;
  const message = error || successText || helper;
  const secure = secureToggle ? !revealed : secureTextEntry;
  const length = value?.length ?? 0;

  const pill = shape === 'pill';
  const borderColor = hasError ? colors.danger : focused ? colors.primary : pill ? colors.transparent : colors.border;
  const fillColor = !editable ? colors.disabledBg : pill && !focused ? colors.bg : colors.card;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <View style={styles.labelRow}>
          <Text variant="label" tone="default">
            {label}
          </Text>
          {required ? (
            <Text variant="label" tone="danger" accessibilityLabel="필수">
              *
            </Text>
          ) : null}
        </View>
      ) : null}

      <View
        style={[
          styles.inputWrap,
          multiline ? styles.inputWrapMultiline : null,
          pill ? styles.inputWrapPill : null,
          { borderColor, backgroundColor: fillColor },
          focused && !hasError ? focusRing : null,
        ]}
      >
        {leftIcon ? (
          <View style={styles.leftIcon}>
            <Icon name={leftIcon} size={20} color={leftIconColor ?? colors.textMuted} />
          </View>
        ) : null}
        <TextInput
          {...rest}
          ref={ref}
          value={value}
          editable={editable}
          multiline={multiline}
          maxLength={maxLength}
          secureTextEntry={secure}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={accessibilityLabel ?? (label ? `${label}${required ? ', 필수' : ''}` : undefined)}
          accessibilityHint={message || undefined}
          {...webOnly({ 'aria-describedby': message ? messageId : undefined, 'aria-invalid': hasError || undefined })}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, multiline ? styles.inputMultiline : null, !editable && styles.inputDisabled, inputStyle]}
          textAlignVertical={multiline ? 'top' : 'center'}
        />
        {secureToggle ? (
          <Pressable
            onPress={() => setRevealed((r) => !r)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? '비밀번호 숨기기' : '비밀번호 보기'}
            hitSlop={4}
            style={styles.trailingButton}
          >
            <Icon name={revealed ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        {right}
      </View>

      {message || (showCounter && maxLength) ? (
        <View style={styles.bottomRow}>
          <View style={styles.message}>
            {hasError ? (
              <View style={styles.errorRow} nativeID={messageId} accessibilityLiveRegion="polite" role="alert">
                <Icon name="alert-circle" size={16} color={colors.danger} />
                <Text variant="secondary" tone="danger" style={styles.flexText}>
                  {error}
                </Text>
              </View>
            ) : successText ? (
              <View style={styles.errorRow} nativeID={messageId} accessibilityLiveRegion="polite">
                <Icon name="checkmark-circle" size={16} color={colors.success} />
                <Text variant="secondary" tone="success" style={styles.flexText}>
                  {successText}
                </Text>
              </View>
            ) : helper ? (
              <Text variant="secondary" tone="secondary" nativeID={messageId}>
                {helper}
              </Text>
            ) : null}
          </View>
          {showCounter && maxLength ? (
            <Text variant="caption" tone={length >= maxLength ? 'danger' : 'muted'} accessibilityLabel={`${maxLength}자 중 ${length}자 입력`}>
              {length}/{maxLength}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs + 2,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: controlHeight.input,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  inputWrapPill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: controlHeight.input + 4,
  },
  inputWrapMultiline: {
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
  },
  leftIcon: {
    marginRight: -2,
  },
  input: {
    flex: 1,
    minHeight: controlHeight.input - 2,
    fontSize: fontSize.body,
    color: colors.text,
    fontFamily,
    paddingVertical: 0,
  },
  inputMultiline: {
    minHeight: 96,
    paddingVertical: spacing.xs,
  },
  inputDisabled: {
    color: colors.textSecondary,
  },
  trailingButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  message: {
    flex: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  flexText: {
    flex: 1,
  },
});
