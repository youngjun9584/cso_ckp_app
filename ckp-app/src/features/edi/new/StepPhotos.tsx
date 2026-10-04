/**
 * 2단계 사진 선택·순서 (DESIGN §7.2).
 * - 추가: 앨범(여러 장) / 카메라 / (웹) 드래그 앤 드롭·파일 입력. 여러 번 나눠 추가해도 합계 30장을 넘지 않는다.
 * - 남은 수보다 많이 가져오면 초과 안내 시트(앞에서부터 N장 / 직접 고르기 / 취소). 취소하면 아무 변화 없음.
 * - 지원하지 않는 파일은 이유와 함께 목록으로 안내하고 추가하지 않는다.
 * - 그리드(드래그·앞/뒤 이동·삭제) 또는 목록 방식, 사진을 누르면 확대 보기('3 / 12').
 */
import { useRef, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import { useShallow } from 'zustand/react/shallow';

import { Button, EmptyState, ImageViewerModal, SegmentedControl, Text, confirm, toast } from '@/components/ui';
import { useLimits } from '@/lib/auth';
import { layout, spacing, useIsWide } from '@/theme';
import { seqMap } from '../draft/order';
import { fullMessage, planAddition, pickSelected, takeFirst } from '../draft/overflow';
import { countPhotos, isCountedPhoto, step2Blocker } from '../draft/progress';
import { ediDraftStore, useEdiDraft } from '../draft/store';
import { DropZone } from '../media/DropZone';
import { captureWithCamera, openAppSettings, pickFromLibrary, supportsFileDrop } from '../media/pick';
import type { PickOutcome, PickedFile } from '../media/types';
import { addFiles, discardPickedFiles, prepareFiles, removeInvalidPhotos, removePhotos, type RejectedFile } from './actions';
import { Notice } from './Notice';
import { OverflowSheet } from './OverflowSheet';
import { PhotoGrid } from './PhotoGrid';
import { PhotoList } from './PhotoList';
import { StepFooterRow } from './StepFooter';
import { AnimatedStepScaffold } from './StepScaffold';
import { useCoarsePointer } from './useCoarsePointer';

type ViewMode = 'grid' | 'list';

interface OverflowRequest {
  id: number;
  files: PickedFile[];
  remaining: number;
}

const VIEW_OPTIONS = [
  { value: 'grid' as const, label: '격자 보기' },
  { value: 'list' as const, label: '목록 보기' },
];

export const STEP2_MAX_WIDTH_WIDE = 1040;

function useColumns(): number {
  const wide = useIsWide();
  const { width } = useWindowDimensions();
  if (wide) return width >= 1360 ? 6 : 5;
  return width >= 600 ? 4 : 3;
}

export function StepPhotos() {
  const limits = useLimits();
  const max = limits.ediMaxPhotos;
  const wide = useIsWide();
  const coarse = useCoarsePointer();
  const columns = useColumns();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  const { photos, phase, setStep, movePhoto, reorderByKeys } = useEdiDraft(
    useShallow((s) => ({
      photos: s.photos,
      phase: s.phase,
      setStep: s.setStep,
      movePhoto: s.movePhoto,
      reorderByKeys: s.reorderByKeys,
    })),
  );
  const locked = phase !== 'editing';
  const counts = countPhotos(photos);
  const seqs = seqMap(photos, isCountedPhoto);
  const remaining = Math.max(0, max - counts.counted);
  const blocker = step2Blocker(photos, limits.ediMinPhotos, max);

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [overflow, setOverflow] = useState<OverflowRequest | null>(null);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const overflowSeq = useRef(0);
  // native 선택기가 열려 있는 동안 중복으로 열지 않는다 (웹은 취소 이벤트가 없을 수 있어 막지 않음)
  const pickerOpen = useRef(false);

  function add(files: PickedFile[]) {
    const result = addFiles(files, limits);
    if (result.notAdded > 0) toast.warning(`최대 ${max}장을 넘어 ${result.notAdded}장은 추가하지 않았습니다.`);
  }

  // native 선택기는 고른 사진마다 앱 캐시에 원본 복사본을 만든다 → draft 에 넣지 않는 파일은 곧바로 지운다
  function handleIncoming(files: PickedFile[]) {
    if (ediDraftStore.get().phase !== 'editing') {
      discardPickedFiles(files);
      return;
    }
    const prepared = prepareFiles(files);
    setRejected(prepared.rejected);
    if (prepared.acceptable.length === 0) return;
    const counted = countPhotos(ediDraftStore.get().photos).counted;
    const plan = planAddition(prepared.acceptable.length, counted, max);
    if (plan.kind === 'fits') add(prepared.acceptable);
    else if (plan.kind === 'full') {
      discardPickedFiles(prepared.acceptable);
      toast.warning(fullMessage(max));
    } else {
      overflowSeq.current += 1;
      setOverflow({ id: overflowSeq.current, files: prepared.acceptable, remaining: plan.remaining });
    }
  }

  async function handleOutcome(outcome: PickOutcome) {
    if (outcome.kind === 'picked') handleIncoming(outcome.files);
    else if (outcome.kind === 'error') toast.error(outcome.message);
    else if (outcome.kind === 'denied') {
      const camera = outcome.target === 'camera';
      const ok = await confirm({
        title: camera ? '카메라 권한이 필요합니다' : '사진 접근 권한이 필요합니다',
        message: camera
          ? 'EDI 사진을 촬영하려면 설정에서 카메라 접근을 허용해 주세요.'
          : 'EDI 사진을 선택하려면 설정에서 사진 접근을 허용해 주세요.',
        confirmText: '설정 열기',
        cancelText: '닫기',
      });
      if (ok) openAppSettings();
    }
    // canceled: 아무 변화 없음
  }

  function open(kind: 'library' | 'camera') {
    if (locked) return;
    if (remaining <= 0) {
      toast.warning(fullMessage(max));
      return;
    }
    if (Platform.OS !== 'web') {
      if (pickerOpen.current) return;
      pickerOpen.current = true;
    }
    // 웹은 클릭 이벤트 안에서 곧바로 파일 창을 열어야 하므로 await 없이 호출한다
    const task = kind === 'library' ? pickFromLibrary(remaining) : captureWithCamera();
    void task
      .then(handleOutcome)
      .catch(() => toast.error('사진을 가져오지 못했습니다. 다시 시도해 주세요.'))
      .finally(() => {
        pickerOpen.current = false;
      });
  }

  function onRemove(localId: string) {
    removePhotos([localId]);
  }

  function onNext() {
    setAttempted(true);
    if (blocker) return;
    setStep(3);
  }

  const readyPhotos = photos.filter((p) => p.state === 'ready' && p.processed);
  const viewerImages = readyPhotos.map((p) => ({
    uri: p.processed?.uri ?? '',
    label: `${seqs.get(p.localId) ?? ''}번 · ${p.sourceName}`,
  }));
  const viewerIndex = viewerId ? readyPhotos.findIndex((p) => p.localId === viewerId) : -1;

  const maxWidth = wide ? STEP2_MAX_WIDTH_WIDE : layout.formMaxWidth;
  const showDropZone = supportsFileDrop && !coarse;
  const webLabels = Platform.OS === 'web';

  return (
    <AnimatedStepScaffold
      scrollRef={scrollRef}
      maxWidth={maxWidth}
      footer={
        <>
          {attempted && blocker ? (
            <Text variant="secondary" tone="danger" accessibilityLiveRegion="polite">
              {blocker}
            </Text>
          ) : null}
          <StepFooterRow>
            <Button title="이전" variant="secondary" size="lg" icon="arrow-back" onPress={() => setStep(1)} disabled={locked} style={styles.prev} />
            <Button
              title={counts.processing > 0 ? `사진 처리 중… (${counts.processing}장)` : '다음 · 확인'}
              size="lg"
              iconRight="arrow-forward"
              onPress={onNext}
              disabled={locked || counts.counted === 0}
              loading={counts.processing > 0}
              style={styles.next}
            />
          </StepFooterRow>
        </>
      }
    >
      <View style={styles.header}>
        <View style={styles.counter} accessibilityLiveRegion="polite" accessibilityLabel={`선택한 사진 ${counts.counted}장, 최대 ${max}장`}>
          <Text variant="title">
            선택한 사진{' '}
            <Text variant="title" tone={counts.counted >= max ? 'accent' : 'primary'}>
              {counts.counted}
            </Text>
            <Text variant="title" tone="muted">
              {' '}
              / {max}
            </Text>
          </Text>
        </View>
        <SegmentedControl options={VIEW_OPTIONS} value={viewMode} onChange={setViewMode} fullWidth={false} accessibilityLabel="보기 방식" />
      </View>

      <View style={styles.addRow}>
        <Button
          title={webLabels ? '사진 파일 선택' : '앨범에서 선택'}
          icon="images-outline"
          size="lg"
          onPress={() => open('library')}
          disabled={locked || remaining <= 0}
          style={styles.addButton}
        />
        <Button
          title="카메라로 촬영"
          icon="camera-outline"
          variant="secondary"
          size="lg"
          onPress={() => open('camera')}
          disabled={locked || remaining <= 0}
          style={styles.addButton}
        />
      </View>
      {/* 30장이 차도 드롭은 받는다 → handleIncoming 이 '최대 30장' 안내를 띄운다(조용히 무시하지 않음) */}
      {showDropZone ? <DropZone onFiles={handleIncoming} disabled={locked} /> : null}
      <Text variant="caption" tone="secondary">
        {remaining > 0 ? `${remaining}장 더 추가할 수 있습니다. ` : `최대 ${max}장을 모두 선택했습니다. `}
        JPG · PNG · WEBP · HEIC 사진, 원본 50MB 이하.
      </Text>

      {rejected.length > 0 ? (
        <Notice
          tone="warning"
          title={`추가하지 못한 파일 ${rejected.length}개`}
          action={<Button title="확인" size="sm" variant="secondary" onPress={() => setRejected([])} />}
        >
          {rejected.slice(0, 6).map((r, i) => (
            <Text key={`${r.name}-${i}`} variant="caption" tone="warning">
              · {r.name} — {r.reason}
            </Text>
          ))}
          {rejected.length > 6 ? (
            <Text variant="caption" tone="warning">
              외 {rejected.length - 6}개
            </Text>
          ) : null}
        </Notice>
      ) : null}

      {counts.invalid > 0 ? (
        <Notice
          tone="danger"
          title={`처리할 수 없는 사진 ${counts.invalid}장`}
          message="이유를 확인하고 제거해 주세요. 이 사진은 등록 장수에 포함되지 않습니다."
          action={<Button title="모두 제거" size="sm" variant="danger" onPress={() => removeInvalidPhotos()} disabled={locked} />}
        />
      ) : null}

      {photos.length === 0 ? (
        <EmptyState
          icon="images-outline"
          title="아직 선택한 사진이 없습니다"
          description="처방전·거래명세서 사진을 선택하세요. 선택한 순서대로 번호가 매겨지고, 등록 전에 순서를 바꿀 수 있습니다."
        />
      ) : (
        <>
          <Text variant="caption" tone="secondary">
            {viewMode === 'grid'
              ? coarse
                ? '사진을 길게 눌러 끌면 순서를 바꿀 수 있습니다. ‹ › 버튼으로도 옮길 수 있습니다.'
                : '사진을 끌어서 순서를 바꿀 수 있습니다. ‹ › 버튼으로도 옮길 수 있습니다.'
              : '버튼으로 순서를 바꿀 수 있습니다. 번호 순서대로 등록됩니다.'}
          </Text>
          {viewMode === 'grid' ? (
            <PhotoGrid
              photos={photos}
              seqs={seqs}
              total={counts.counted}
              columns={columns}
              locked={locked}
              scrollRef={scrollRef}
              onOpen={setViewerId}
              onRemove={onRemove}
              onMove={movePhoto}
              onReorder={reorderByKeys}
            />
          ) : (
            <PhotoList photos={photos} seqs={seqs} total={counts.counted} locked={locked} onOpen={setViewerId} onRemove={onRemove} onMove={movePhoto} />
          )}
        </>
      )}

      {overflow ? (
        <OverflowSheet
          key={overflow.id}
          files={overflow.files}
          remaining={overflow.remaining}
          max={max}
          onCancel={() => {
            // 시트를 닫기로 한 뒤에만 지운다 (열려 있는 동안은 이 파일들을 미리보기로 보여 준다)
            setOverflow(null);
            discardPickedFiles(overflow.files);
          }}
          onAddFirst={() => {
            const files = takeFirst(overflow.files, overflow.remaining);
            setOverflow(null);
            discardPickedFiles(overflow.files.filter((f) => !files.includes(f)));
            add(files);
          }}
          onAddSelected={(indices) => {
            const files = pickSelected(overflow.files, new Set(indices));
            setOverflow(null);
            discardPickedFiles(overflow.files.filter((f) => !files.includes(f)));
            add(files);
          }}
        />
      ) : null}

      <ImageViewerModal
        images={viewerImages}
        index={Math.max(0, viewerIndex)}
        visible={viewerIndex >= 0}
        onClose={() => setViewerId(null)}
        onIndexChange={(i) => setViewerId(readyPhotos[i]?.localId ?? null)}
      />
    </AnimatedStepScaffold>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  counter: {
    gap: 0,
  },
  addRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  addButton: {
    flex: 1,
  },
  prev: {
    flex: 1,
  },
  next: {
    flex: 2,
  },
});
