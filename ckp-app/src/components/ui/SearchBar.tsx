import { useEffect, useEffectEvent, useRef, type Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, controlHeight, fontFamily, fontSize, radius, spacing } from '@/theme';
import { Icon } from './Icon';

export interface SearchBarProps extends Omit<TextInputProps, 'style' | 'value' | 'onChangeText' | 'onSubmitEditing'> {
  value: string;
  onChangeText: (text: string) => void;
  /** 키보드 검색/Enter */
  onSubmit?: (text: string) => void;
  /** 지정하면 입력이 멈춘 뒤 debounceMs 후 호출 (입력 중 검색) */
  onDebouncedChange?: (text: string) => void;
  debounceMs?: number;
  /** 지우기 버튼을 누른 뒤 추가 동작 (기본: onChangeText('') + onSubmit('')) */
  onClear?: () => void;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<TextInput>;
}

export function SearchBar({
  value,
  onChangeText,
  onSubmit,
  onDebouncedChange,
  debounceMs = 350,
  onClear,
  loading,
  placeholder = '검색어를 입력하세요',
  style,
  accessibilityLabel,
  ref,
  ...rest
}: SearchBarProps) {
  const firstRun = useRef(true);
  const fireDebounced = useEffectEvent((text: string) => onDebouncedChange?.(text));

  useEffect(() => {
    // 처음 마운트될 때는 호출하지 않는다
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = setTimeout(() => fireDebounced(value), debounceMs);
    return () => clearTimeout(timer);
  }, [value, debounceMs]);

  function clear() {
    onChangeText('');
    if (onClear) onClear();
    else onSubmit?.('');
  }

  return (
    <View style={[styles.wrap, style]}>
      <Icon name="search" size={20} color={colors.textMuted} />
      <TextInput
        {...rest}
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={() => onSubmit?.(value.trim())}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="search"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        role="searchbox"
        style={styles.input}
      />
      {loading ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      {value.length > 0 ? (
        <Pressable
          onPress={clear}
          accessibilityRole="button"
          accessibilityLabel="검색어 지우기"
          hitSlop={4}
          style={styles.clear}
        >
          <Icon name="close-circle" size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: controlHeight.input,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: controlHeight.input - 2,
    fontSize: fontSize.body,
    color: colors.text,
    fontFamily,
    paddingVertical: 0,
  },
  clear: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
