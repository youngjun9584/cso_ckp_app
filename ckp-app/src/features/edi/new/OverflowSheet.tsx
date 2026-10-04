/**
 * 30장 초과 안내 시트 (DESIGN §7.2) — 절대 조용히 버리지 않는다.
 *   [앞에서부터 N장 추가] / [직접 고르기(체크 해제로 N장 이하가 되어야 추가 가능)] / [취소하고 다시 선택]
 * 부모가 key 를 바꿔 새로 띄우므로 내부 상태는 처음 값으로 시작한다.
 */
import { useState } from 'react';
import { FlatList, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, Text } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import { formatBytes } from '@/lib/format';
import { colors, radius, shadow, spacing, useIsWide } from '@/theme';
import { manualSelectionState, overflowMessage } from '../draft/overflow';
import { displayName } from '../media/file-type';
import type { PickedFile } from '../media/types';

export interface OverflowSheetProps {
  files: PickedFile[];
  remaining: number;
  max: number;
  onAddFirst: () => void;
  onAddSelected: (indices: number[]) => void;
  onCancel: () => void;
}

export function OverflowSheet({ files, remaining, max, onAddFirst, onAddSelected, onCancel }: OverflowSheetProps) {
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'choose' | 'manual'>('choose');
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set(files.map((_, i) => i)));
  const sel = manualSelectionState(selected.size, remaining);

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const panelStyle = [
    styles.panel,
    wide ? styles.panelWide : [styles.panelSheet, { paddingBottom: spacing.lg + insets.bottom }],
    mode === 'manual' && styles.panelTall,
  ];

  return (
    <Modal visible transparent animationType={wide ? 'fade' : 'slide'} statusBarTranslucent onRequestClose={onCancel}>
      <View style={[styles.root, wide ? styles.rootCenter : styles.rootBottom]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="닫기" importantForAccessibility="no" tabIndex={-1} />
        <View style={panelStyle} role="dialog" aria-modal accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Icon name="images-outline" size={22} color={colors.accentText} />
            </View>
            <View style={styles.flex}>
              <Text variant="heading" role="heading">
                사진이 너무 많습니다
              </Text>
              <Text variant="body" tone="secondary">
                {overflowMessage(files.length, remaining, max)}
              </Text>
            </View>
          </View>

          {mode === 'choose' ? (
            <View style={styles.options}>
              <Button title={`앞에서부터 ${remaining}장 추가`} size="lg" icon="add-circle-outline" onPress={onAddFirst} fullWidth />
              <Button
                title="직접 고르기"
                size="lg"
                variant="secondary"
                icon="checkbox-outline"
                onPress={() => setMode('manual')}
                fullWidth
              />
              <Button title="취소하고 다시 선택" size="lg" variant="ghost" onPress={onCancel} fullWidth />
            </View>
          ) : (
            <>
              <View style={styles.selectionBar}>
                <Text variant="label" tone={sel.excess > 0 ? 'danger' : 'success'} accessibilityLiveRegion="polite">
                  {sel.excess > 0
                    ? `선택 ${sel.selected}장 · ${sel.excess}장을 더 해제해 주세요 (최대 ${remaining}장)`
                    : `선택 ${sel.selected}장 · 추가할 수 있습니다`}
                </Text>
                <View style={styles.quick}>
                  <Button
                    title={`앞 ${remaining}장만`}
                    size="sm"
                    variant="soft"
                    onPress={() => setSelected(new Set(files.slice(0, remaining).map((_, i) => i)))}
                  />
                  <Button title="모두 해제" size="sm" variant="ghost" onPress={() => setSelected(new Set())} />
                </View>
              </View>
              <FlatList
                data={files}
                keyExtractor={(_, i) => String(i)}
                style={styles.list}
                initialNumToRender={12}
                windowSize={5}
                renderItem={({ item, index }) => {
                  const checked = selected.has(index);
                  const name = displayName(item.name, index + 1);
                  return (
                    <Pressable
                      onPress={() => toggle(index)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={`${index + 1}번째로 가져온 사진 ${name}`}
                      style={(state) => [styles.item, asInteraction(state).hovered && styles.itemHover]}
                    >
                      <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                        {checked ? <Icon name="checkmark" size={16} color={colors.white} /> : null}
                      </View>
                      <Text variant="caption" tone="muted" style={styles.order}>
                        {index + 1}
                      </Text>
                      {/* native 는 expo-image 가 표시 크기로 줄여 디코딩한다. 웹은 원본 전체를 디코딩하므로 목록에서는 그리지 않는다 */}
                      {Platform.OS !== 'web' && item.uri ? (
                        <Image source={{ uri: item.uri }} style={styles.thumb} contentFit="cover" transition={0} />
                      ) : (
                        <View style={[styles.thumb, styles.thumbIcon]}>
                          <Icon name="image-outline" size={18} color={colors.textMuted} />
                        </View>
                      )}
                      <View style={styles.flex}>
                        <Text variant="body" numberOfLines={1}>
                          {name}
                        </Text>
                        {item.size ? (
                          <Text variant="caption" tone="secondary">
                            {formatBytes(item.size)}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                }}
              />
              <View style={styles.footer}>
                <Button title="취소" variant="secondary" onPress={onCancel} style={styles.flex} />
                <Button
                  title={sel.canAdd ? `선택한 ${sel.selected}장 추가` : '추가할 사진 선택'}
                  onPress={() => onAddSelected([...selected].sort((a, b) => a - b))}
                  disabled={!sel.canAdd}
                  style={styles.flex2}
                />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // RN-web Modal 래퍼는 늘어나지 않으므로 전체 채우기
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.overlay,
  },
  rootBottom: {
    justifyContent: 'flex-end',
  },
  rootCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  panel: {
    backgroundColor: colors.card,
    padding: spacing.xl,
    gap: spacing.lg,
    ...shadow.overlay,
  },
  panelSheet: {
    borderTopLeftRadius: radius.card + 4,
    borderTopRightRadius: radius.card + 4,
    maxHeight: '88%',
  },
  panelWide: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '86%',
    borderRadius: radius.card + 2,
  },
  panelTall: {
    height: '82%',
  },
  header: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  flex2: {
    flex: 2,
  },
  options: {
    gap: spacing.sm,
  },
  selectionBar: {
    gap: spacing.sm,
  },
  quick: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  list: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
  },
  item: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  itemHover: {
    backgroundColor: '#F6F8FB',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  order: {
    width: 22,
    textAlign: 'right',
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.divider,
  },
  thumbIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
