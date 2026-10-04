import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import type { EdiPhoto } from '@/lib/api';
import { colors, radius, spacing } from '@/theme';
import { EdiThumb } from './EdiThumb';
import { PhotoStatusChips } from './StatusBadges';
import { PHOTO_FLAG_META, isMissingPhoto, reviewStatusLabel } from './status';

const GAP = spacing.md;

export interface PhotoGridProps {
  /** 서버가 준 순서(seq 오름차순) 그대로 */
  photos: EdiPhoto[];
  onOpen: (photo: EdiPhoto) => void;
  onImageError?: () => void;
  /** 사진 칸 최소 너비 — 너비에 맞춰 열 수를 정한다 */
  minTileWidth?: number;
  minColumns?: number;
  maxColumns?: number;
}

export function canViewPhoto(photo: EdiPhoto): boolean {
  return !isMissingPhoto(photo) && !!(photo.imageUrl || photo.thumbUrl);
}

function photoA11yLabel(photo: EdiPhoto): string {
  if (isMissingPhoto(photo)) return `${photo.seq}번 사진, 관리자에 의해 삭제됨`;
  const parts = [`${photo.seq}번 사진`, reviewStatusLabel(photo.reviewStatus)];
  if (photo.printed) parts.push(PHOTO_FLAG_META.printed.label);
  if (photo.analyzed) parts.push(PHOTO_FLAG_META.analyzed.label);
  if (photo.pharmaCompanies.length > 0) parts.push(`제약사 ${photo.pharmaCompanies.join(', ')}`);
  return parts.join(', ');
}

/** 제출 건 사진 격자: 순번 배지(1..N) + 사진별 상태 칩 */
export function PhotoGrid({ photos, onOpen, onImageError, minTileWidth = 104, minColumns = 3, maxColumns = 6 }: PhotoGridProps) {
  const [width, setWidth] = useState(0);
  const fit = width > 0 ? Math.floor((width + GAP) / (minTileWidth + GAP)) : minColumns;
  const columns = Math.max(minColumns, Math.min(maxColumns, fit));

  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };

  return (
    <View style={styles.grid} onLayout={onLayout}>
      {photos.map((photo) => (
        <View key={`${photo.seq}-${photo.ediIdx ?? 'x'}`} style={[styles.cell, { width: `${100 / columns}%` }]}>
          <PhotoTile photo={photo} onOpen={onOpen} onImageError={onImageError} />
        </View>
      ))}
    </View>
  );
}

interface PhotoTileProps {
  photo: EdiPhoto;
  onOpen: (photo: EdiPhoto) => void;
  onImageError?: () => void;
}

function PhotoTile({ photo, onOpen, onImageError }: PhotoTileProps) {
  const missing = isMissingPhoto(photo);
  const viewable = canViewPhoto(photo);
  const label = photoA11yLabel(photo);

  return (
    <View style={styles.tile}>
      <Pressable
        disabled={!viewable}
        onPress={() => onOpen(photo)}
        accessibilityRole={viewable ? 'imagebutton' : 'image'}
        accessibilityLabel={viewable ? `${label}. 눌러서 크게 보기` : label}
        style={(state) => {
          const { hovered, focused, pressed } = asInteraction(state);
          return [
            styles.frame,
            missing && styles.frameMissing,
            viewable && (hovered || focused) && styles.frameActive,
            pressed && styles.framePressed,
          ];
        }}
      >
        {missing ? (
          <View style={styles.missing}>
            <Icon name="trash-outline" size={22} color={colors.textMuted} />
            <Text variant="caption" tone="muted" align="center">
              관리자에 의해 삭제됨
            </Text>
          </View>
        ) : (
          <EdiThumb uri={photo.thumbUrl ?? photo.imageUrl} style={StyleSheet.absoluteFill} showErrorText onError={onImageError} />
        )}
        <View style={[styles.seq, missing && styles.seqMuted]} pointerEvents="none">
          <Text variant="caption" weight="bold" color={colors.white}>
            {photo.seq}
          </Text>
        </View>
      </Pressable>
      <PhotoStatusChips photo={photo} />
      {!missing && photo.pharmaCompanies.length > 0 ? (
        <Text variant="caption" tone="secondary" numberOfLines={2}>
          {photo.pharmaCompanies.join(', ')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -GAP / 2,
    rowGap: spacing.lg,
  },
  cell: {
    paddingHorizontal: GAP / 2,
  },
  tile: {
    gap: spacing.xs + 2,
  },
  frame: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  frameMissing: {
    borderStyle: 'dashed',
    borderColor: '#C7D2E0',
    backgroundColor: colors.bg,
  },
  frameActive: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  framePressed: {
    opacity: 0.85,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  seq: {
    position: 'absolute',
    top: 6,
    left: 6,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    boxShadow: '0px 1px 3px rgba(15, 35, 66, 0.25)',
  },
  seqMuted: {
    backgroundColor: colors.textMuted,
  },
});
