/** 3단계 표시 (1 기본 정보 · 2 사진 선택 · 3 확인·등록). 지난 단계는 눌러서 돌아갈 수 있다. */
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import { colors, layout, spacing, useIsWide } from '@/theme';
import type { DraftStep } from '../draft/types';

export const STEP_LABELS: Record<DraftStep, string> = {
  1: '기본 정보',
  2: '사진 선택',
  3: '확인·등록',
};

const STEPS: DraftStep[] = [1, 2, 3];

export interface StepperProps {
  step: DraftStep;
  /** 지난 단계로 이동 (잠금 중이면 undefined) */
  onStepPress?: (step: DraftStep) => void;
  maxWidth?: number;
}

export function Stepper({ step, onStepPress, maxWidth = layout.formMaxWidth }: StepperProps) {
  const wide = useIsWide();
  const gutter = wide ? layout.gutterWide : layout.gutter;
  return (
    <View style={styles.bar}>
      <View
        style={[styles.row, { paddingHorizontal: gutter }, wide && { maxWidth: maxWidth + gutter * 2 }]}
        accessibilityRole="progressbar"
        accessibilityLabel={`3단계 중 ${step}단계, ${STEP_LABELS[step]}`}
      >
        {STEPS.map((s, i) => {
          const done = s < step;
          const current = s === step;
          const canPress = !!onStepPress && done;
          return (
            <View key={s} style={styles.item}>
              {i > 0 ? <View style={[styles.line, s <= step && styles.lineActive]} /> : null}
              <Pressable
                disabled={!canPress}
                onPress={() => onStepPress?.(s)}
                accessibilityRole="button"
                accessibilityLabel={`${s}단계 ${STEP_LABELS[s]}${current ? ', 현재 단계' : done ? ', 완료 — 눌러서 돌아가기' : ''}`}
                accessibilityState={{ disabled: !canPress, selected: current }}
                style={(state) => [styles.stepButton, canPress && asInteraction(state).hovered && styles.hover]}
              >
                <View style={[styles.circle, current && styles.circleCurrent, done && styles.circleDone]}>
                  {done ? (
                    <Icon name="checkmark" size={16} color={colors.white} />
                  ) : (
                    <Text variant="label" color={current ? colors.white : colors.textMuted}>
                      {s}
                    </Text>
                  )}
                </View>
                <Text
                  variant={current ? 'label' : 'caption'}
                  color={current ? colors.primaryStrong : done ? colors.text : colors.textMuted}
                  numberOfLines={1}
                >
                  {STEP_LABELS[s]}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    alignSelf: 'center',
  },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  line: {
    flex: 1,
    height: 2,
    marginHorizontal: spacing.xs,
    backgroundColor: colors.border,
  },
  lineActive: {
    backgroundColor: colors.primary,
  },
  stepButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: 10,
  },
  hover: {
    backgroundColor: colors.divider,
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleCurrent: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  circleDone: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
});
