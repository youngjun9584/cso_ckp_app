import { useState, type Ref } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';

import { Icon, Text, TextField } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import { colors, radius, spacing } from '@/theme';
import { CLIENT_FIELD_LIMITS } from './validation';

export const CLIENT_TYPE_OPTIONS = ['의원', '병원', '종합병원', '요양병원', '약국', '기타'] as const;

const isPreset = (value: string) => (CLIENT_TYPE_OPTIONS as readonly string[]).includes(value);

export interface ClientTypeFieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
  inputRef?: Ref<TextInput>;
}

/** 거래처 구분: 자주 쓰는 값은 칩으로 고르고, 그 밖의 값은 '직접 입력' */
export function ClientTypeField({ value, onChange, error, disabled, inputRef }: ClientTypeFieldProps) {
  const [customMode, setCustomMode] = useState(() => value !== '' && !isPreset(value));
  const custom = customMode || (value !== '' && !isPreset(value));

  function pickPreset(option: string) {
    setCustomMode(false);
    onChange(value === option && !custom ? '' : option);
  }

  function toggleCustom() {
    if (custom) {
      setCustomMode(false);
      onChange('');
    } else {
      setCustomMode(true);
      onChange('');
    }
  }

  return (
    <View style={styles.container}>
      <Text variant="label">거래처 구분</Text>
      <View style={styles.chips} role="radiogroup" accessibilityLabel="거래처 구분">
        {CLIENT_TYPE_OPTIONS.map((option) => (
          <Chip key={option} label={option} selected={!custom && value === option} disabled={disabled} onPress={() => pickPreset(option)} />
        ))}
        <Chip label="직접 입력" icon="create-outline" selected={custom} disabled={disabled} onPress={toggleCustom} />
      </View>
      {custom ? (
        <TextField
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          placeholder="거래처 구분을 입력하세요 (예: 치과의원)"
          accessibilityLabel="거래처 구분 직접 입력"
          maxLength={CLIENT_FIELD_LIMITS.clientType}
          editable={!disabled}
          error={error}
          autoFocus={customMode && value === ''}
          returnKeyType="next"
        />
      ) : error ? (
        <Text variant="secondary" tone="danger" role="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  icon?: 'create-outline';
}

function Chip({ label, selected, onPress, disabled, icon }: ChipProps) {
  const fg = selected ? colors.primaryStrong : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      aria-checked={selected}
      aria-disabled={!!disabled}
      style={(state) => {
        const { hovered, pressed } = asInteraction(state);
        return [
          styles.chip,
          selected ? styles.chipSelected : null,
          !selected && (hovered || pressed) ? styles.chipHover : null,
          disabled ? styles.chipDisabled : null,
        ];
      }}
    >
      {selected ? <Icon name="checkmark" size={16} color={fg} /> : icon ? <Icon name={icon} size={16} color={colors.textSecondary} /> : null}
      <Text variant="label" color={fg} weight={selected ? 'semibold' : 'medium'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  chipHover: {
    backgroundColor: '#F6F8FB',
  },
  chipDisabled: {
    opacity: 0.5,
  },
});
