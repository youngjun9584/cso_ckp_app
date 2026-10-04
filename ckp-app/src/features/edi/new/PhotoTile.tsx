/**
 * 사진 그리드 한 칸: 썸네일(원본은 절대 그리지 않음) + 큰 순번 배지 + 삭제(×) + 앞/뒤 이동 + 처리 중/처리 불가/업로드 상태.
 * 드래그는 썸네일 영역(Sortable.Handle)에서만 시작하고, 버튼들은 핸들 밖(형제)이라 눌러도 드래그가 시작되지 않는다.
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Sortable from 'react-native-sortables';

import { Icon, Text, alertDialog } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import { colors, radius, spacing } from '@/theme';
import type { MoveDirection } from '../draft/order';
import type { DraftPhoto } from '../draft/types';

export interface PhotoTileProps {
  photo: DraftPhoto;
  /** 순번 (처리 불가 사진은 undefined) */
  seq: number | undefined;
  total: number;
  locked: boolean;
  /** Sortable.Grid 안에서 그릴 때 true (드래그 핸들 사용) */
  sortable: boolean;
  onOpen: (localId: string) => void;
  onRemove: (localId: string) => void;
  onMove: (localId: string, direction: MoveDirection) => void;
}

function SmallButton({
  icon,
  label,
  onPress,
  disabled,
  tone = 'dark',
}: {
  icon: 'close' | 'chevron-back' | 'chevron-forward';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'dark' | 'light';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={(state) => {
        const { hovered, pressed } = asInteraction(state);
        return [
          styles.smallButton,
          tone === 'light' && styles.smallButtonLight,
          (hovered || pressed) && !disabled && styles.smallButtonActive,
          disabled && styles.smallButtonDisabled,
        ];
      }}
    >
      <Icon name={icon} size={18} color={tone === 'light' ? colors.text : colors.white} />
    </Pressable>
  );
}

function UploadChip({ photo }: { photo: DraftPhoto }) {
  const s = photo.upload.state;
  if (s === 'idle') return null;
  if (s === 'uploaded') {
    return (
      <View style={[styles.chip, { backgroundColor: colors.success }]} accessibilityLabel="업로드 완료">
        <Icon name="checkmark" size={12} color={colors.white} />
      </View>
    );
  }
  if (s === 'failed') {
    return (
      <View style={[styles.chip, { backgroundColor: colors.danger }]} accessibilityLabel="업로드 실패">
        <Text variant="caption" color={colors.white} weight="bold">
          실패
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.chip, { backgroundColor: colors.primary }]}>
      <Text variant="caption" color={colors.white} weight="bold">
        {s === 'queued' ? '대기' : `${Math.round(photo.upload.progress * 100)}%`}
      </Text>
    </View>
  );
}

export function PhotoTile({ photo, seq, total, locked, sortable, onOpen, onRemove, onMove }: PhotoTileProps) {
  const ready = photo.state === 'ready' && !!photo.processed;
  const invalid = photo.state === 'invalid';
  const label = seq ? `${seq}번 사진` : '처리할 수 없는 사진';

  const thumb = ready && photo.processed ? (
    <Image
      source={{ uri: photo.processed.thumbUri }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      recyclingKey={photo.localId}
      transition={0}
      accessibilityLabel={`${label} ${photo.sourceName}`}
    />
  ) : (
    <View style={[StyleSheet.absoluteFill, styles.placeholder, invalid && styles.placeholderInvalid]}>
      {invalid ? (
        <Icon name="alert-circle" size={28} color={colors.danger} />
      ) : (
        <>
          <ActivityIndicator color={colors.primary} />
          <Text variant="caption" tone="secondary">
            처리 중
          </Text>
        </>
      )}
    </View>
  );

  const openable = ready && !locked;
  const inner = openable ? (
    sortable ? (
      <Sortable.Touchable onTap={() => onOpen(photo.localId)} style={StyleSheet.absoluteFill}>
        {thumb}
      </Sortable.Touchable>
    ) : (
      <Pressable onPress={() => onOpen(photo.localId)} style={StyleSheet.absoluteFill} accessibilityRole="imagebutton" accessibilityLabel={`${label} 크게 보기`}>
        {thumb}
      </Pressable>
    )
  ) : (
    thumb
  );

  const showReason = () => {
    void alertDialog({ title: '처리할 수 없는 사진', message: `${photo.sourceName}\n\n${photo.invalidReason ?? '사진을 처리하지 못했습니다.'}` });
  };

  return (
    <View style={styles.tile}>
      {sortable ? (
        <Sortable.Handle mode={locked ? 'non-draggable' : 'draggable'} style={StyleSheet.absoluteFill}>
          {inner}
        </Sortable.Handle>
      ) : (
        <View style={StyleSheet.absoluteFill}>{inner}</View>
      )}

      {invalid ? (
        <View style={styles.invalidOverlay}>
          <Pressable
            onPress={showReason}
            accessibilityRole="button"
            accessibilityLabel={`처리할 수 없는 사진: ${photo.invalidReason ?? ''}. 자세히 보기`}
          >
            <Text variant="caption" color={colors.danger} weight="semibold" numberOfLines={3} align="center">
              {photo.invalidReason ?? '처리할 수 없는 사진입니다.'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onRemove(photo.localId)}
            disabled={locked}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${photo.sourceName} 제거`}
            style={(state) => [styles.removeButton, asInteraction(state).hovered && styles.removeButtonHover]}
          >
            <Text variant="caption" color={colors.white} weight="bold">
              제거
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.topRow} pointerEvents="box-none">
        {seq ? (
          <View style={styles.seq} accessibilityLabel={`순번 ${seq}`}>
            <Text variant="bodyStrong" color={colors.white} style={styles.seqText}>
              {seq}
            </Text>
          </View>
        ) : (
          <View style={[styles.seq, styles.seqInvalid]}>
            <Icon name="alert" size={16} color={colors.white} />
          </View>
        )}
        {!invalid ? (
          <SmallButton icon="close" label={`${label} 삭제`} onPress={() => onRemove(photo.localId)} disabled={locked} />
        ) : null}
      </View>

      {!invalid && seq ? (
        <View style={styles.bottomRow} pointerEvents="box-none">
          <SmallButton
            icon="chevron-back"
            label={`${seq}번 사진을 앞으로 이동`}
            onPress={() => onMove(photo.localId, 'earlier')}
            disabled={locked || seq <= 1}
          />
          <UploadChip photo={photo} />
          <SmallButton
            icon="chevron-forward"
            label={`${seq}번 사진을 뒤로 이동`}
            onPress={() => onMove(photo.localId, 'later')}
            disabled={locked || seq >= total}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.control,
    overflow: 'hidden',
    backgroundColor: colors.divider,
    borderWidth: 1,
    borderColor: colors.border,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.divider,
  },
  placeholderInvalid: {
    backgroundColor: colors.dangerSoft,
  },
  invalidOverlay: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    top: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
    backgroundColor: 'rgba(252,235,236,0.92)',
  },
  removeButton: {
    minHeight: 32,
    minWidth: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonHover: {
    backgroundColor: '#A92A32',
  },
  topRow: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    right: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  bottomRow: {
    position: 'absolute',
    bottom: spacing.xs,
    left: spacing.xs,
    right: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  seq: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: 6,
    borderRadius: 15,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seqInvalid: {
    backgroundColor: colors.danger,
  },
  seqText: {
    lineHeight: 20,
  },
  smallButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(15,35,66,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonLight: {
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  smallButtonActive: {
    backgroundColor: 'rgba(15,35,66,0.85)',
  },
  smallButtonDisabled: {
    opacity: 0.35,
  },
  chip: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
