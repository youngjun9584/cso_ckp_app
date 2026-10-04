/**
 * 목록 방식 보기 (키보드·스크린리더용, DESIGN §7.2): 순번 · 파일명 · 크기 · [맨 앞][앞으로][뒤로][맨 뒤] · 삭제.
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { Button, Icon, IconButton, Text } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import { formatBytes } from '@/lib/format';
import { colors, radius, spacing } from '@/theme';
import type { MoveDirection } from '../draft/order';
import type { DraftPhoto } from '../draft/types';

export interface PhotoListProps {
  photos: DraftPhoto[];
  seqs: ReadonlyMap<string, number>;
  total: number;
  locked: boolean;
  onOpen: (localId: string) => void;
  onRemove: (localId: string) => void;
  onMove: (localId: string, direction: MoveDirection) => void;
}

function statusText(photo: DraftPhoto): { text: string; tone: 'secondary' | 'danger' | 'success' | 'primary' } {
  if (photo.state === 'processing') return { text: '처리 중…', tone: 'secondary' };
  if (photo.state === 'invalid') return { text: photo.invalidReason ?? '처리할 수 없는 사진입니다.', tone: 'danger' };
  const u = photo.upload;
  if (u.state === 'uploaded') return { text: '업로드 완료', tone: 'success' };
  if (u.state === 'failed') return { text: u.error ?? '업로드 실패', tone: 'danger' };
  if (u.state === 'uploading') return { text: `업로드 중 ${Math.round(u.progress * 100)}%`, tone: 'primary' };
  if (u.state === 'queued') return { text: '업로드 대기', tone: 'secondary' };
  return { text: '준비됨', tone: 'secondary' };
}

export function PhotoList({ photos, seqs, total, locked, onOpen, onRemove, onMove }: PhotoListProps) {
  return (
    <View style={styles.list} accessibilityRole="list">
      {photos.map((photo) => {
        const seq = seqs.get(photo.localId);
        const status = statusText(photo);
        const bytes = photo.processed?.bytes ?? photo.bytes;
        const ready = photo.state === 'ready' && !!photo.processed;
        const move = (direction: MoveDirection, label: string, a11y: string, disabled: boolean) => (
          <Button
            title={label}
            size="sm"
            variant="secondary"
            onPress={() => onMove(photo.localId, direction)}
            disabled={locked || disabled}
            accessibilityLabel={`${seq}번 사진을 ${a11y} 이동`}
          />
        );
        return (
          <View key={photo.localId} style={styles.row} accessibilityRole="none">
            <View style={styles.top}>
              <View style={[styles.seq, !seq && styles.seqInvalid]}>
                {seq ? (
                  <Text variant="label" color={colors.white}>
                    {seq}
                  </Text>
                ) : (
                  <Icon name="alert" size={14} color={colors.white} />
                )}
              </View>
              <Pressable
                onPress={() => onOpen(photo.localId)}
                disabled={!ready}
                accessibilityRole="button"
                accessibilityLabel={ready ? `${seq}번 사진 ${photo.sourceName} 크게 보기` : photo.sourceName}
                style={(state) => [styles.info, ready && asInteraction(state).hovered && styles.infoHover]}
              >
                <View style={styles.thumb}>
                  {ready && photo.processed ? (
                    <Image source={{ uri: photo.processed.thumbUri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={photo.localId} transition={0} />
                  ) : photo.state === 'processing' ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Icon name="alert-circle" size={20} color={colors.danger} />
                  )}
                </View>
                <View style={styles.texts}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {photo.sourceName}
                  </Text>
                  <Text variant="caption" tone={status.tone} numberOfLines={2}>
                    {[bytes ? formatBytes(bytes) : null, status.text].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
              <IconButton
                icon="trash-outline"
                accessibilityLabel={seq ? `${seq}번 사진 삭제` : `${photo.sourceName} 제거`}
                onPress={() => onRemove(photo.localId)}
                disabled={locked}
                color={colors.danger}
              />
            </View>
            {seq ? (
              <View style={styles.actions}>
                {move('first', '맨 앞', '맨 앞으로', seq <= 1)}
                {move('earlier', '앞으로', '앞으로', seq <= 1)}
                {move('later', '뒤로', '뒤로', seq >= total)}
                {move('last', '맨 뒤', '맨 뒤로', seq >= total)}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  seq: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 4,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seqInvalid: {
    backgroundColor: colors.danger,
  },
  info: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.control,
  },
  infoHover: {
    backgroundColor: colors.divider,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
    minWidth: 0,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingLeft: 36,
  },
});
