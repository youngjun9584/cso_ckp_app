/**
 * 드래그 재정렬 그리드 (react-native-sortables Sortable.Grid, v1.10 — node_modules 의 타입 확인).
 * customHandle: 썸네일 영역만 드래그 핸들. 길게 눌러 끌기(native·터치 브라우저), 마우스는 짧은 지연.
 * 순번은 배열 순서(처리 불가 사진 제외) — 삭제·이동 즉시 다시 매겨진다.
 */
import { Platform, StyleSheet, View } from 'react-native';
import type Animated from 'react-native-reanimated';
import type { AnimatedRef } from 'react-native-reanimated';
import Sortable from 'react-native-sortables';

import { spacing } from '@/theme';
import type { MoveDirection } from '../draft/order';
import type { DraftPhoto } from '../draft/types';
import { PhotoTile } from './PhotoTile';
import { useCoarsePointer } from './useCoarsePointer';

export interface PhotoGridProps {
  photos: DraftPhoto[];
  seqs: ReadonlyMap<string, number>;
  total: number;
  columns: number;
  locked: boolean;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  onOpen: (localId: string) => void;
  onRemove: (localId: string) => void;
  onMove: (localId: string, direction: MoveDirection) => void;
  onReorder: (keys: string[]) => void;
}

const GAP = spacing.sm;

export function PhotoGrid({ photos, seqs, total, columns, locked, scrollRef, onOpen, onRemove, onMove, onReorder }: PhotoGridProps) {
  const coarse = useCoarsePointer();
  // 터치는 스크롤과 구분하도록 길게 누르기, 마우스는 짧은 지연
  const dragDelay = coarse ? 300 : 90;

  return (
    <View style={styles.wrap}>
      <Sortable.Grid
        data={photos}
        keyExtractor={(p) => p.localId}
        columns={columns}
        rowGap={GAP}
        columnGap={GAP}
        customHandle
        sortEnabled={!locked}
        dragActivationDelay={dragDelay}
        hapticsEnabled={Platform.OS !== 'web'}
        scrollableRef={scrollRef}
        autoScrollActivationOffset={80}
        activeItemScale={1.06}
        inactiveItemOpacity={0.75}
        onDragEnd={({ data }) => onReorder(data.map((p) => p.localId))}
        renderItem={({ item }) => (
          <PhotoTile
            photo={item}
            seq={seqs.get(item.localId)}
            total={total}
            locked={locked}
            sortable
            onOpen={onOpen}
            onRemove={onRemove}
            onMove={onMove}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
});
