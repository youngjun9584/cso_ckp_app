/**
 * 3단계 확인·등록 (DESIGN §7.2): 요약 + 최종 순서 썸네일 + 사진별/전체 업로드 진행률 + 하단 [사진 N장 등록하기].
 * 제출 중에는 모든 편집이 잠기고, 결과가 불확실하면 잠금을 유지한 채 [다시 시도](같은 요청)만 할 수 있다.
 * 서버가 5xx 를 계속 돌려주면 확인 후 [편집으로 돌아가기](키 유지)를 고를 수 있다.
 * 같은 키로 이미 다른 내용이 등록됐다는 응답(409)이면 다시 보내지 않고 [등록 내역 확인]·[새로 작성하기]를 안내한다.
 */
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';

import { Button, Card, ImageViewerModal, InfoRow, SectionTitle, Text, confirm } from '@/components/ui';
import { useLimits } from '@/lib/auth';
import { formatYm } from '@/lib/kst';
import { spacing } from '@/theme';
import { summarizeUploads } from '../draft/progress';
import { useEdiDraft } from '../draft/store';
import { resetDraft } from './actions';
import { Notice } from './Notice';
import { useEdiMonthOptions } from './queries';
import { StepFooterRow } from './StepFooter';
import { StepScaffold } from './StepScaffold';
import { retryPendingSubmission, startSubmit, unlockUncertainSubmission } from './submit';
import { ThumbStrip } from './ThumbStrip';
import { UploadProgress } from './UploadProgress';

/** 등록 내역(EDI 탭 첫 화면)으로 — 작성 건은 메모리에 그대로 남아 [새 EDI 등록]으로 다시 열 수 있다 */
function openHistory(): void {
  // POP_TO_TOP 은 작성 화면의 이탈 확인을 거치지 않는다(사용자가 직접 고른 이동이고 내용은 유지된다)
  if (router.canDismiss()) router.dismissAll();
  else router.replace('/edi');
}

async function confirmUnlock(): Promise<void> {
  const ok = await confirm({
    title: '편집으로 돌아갈까요?',
    message:
      '앞서 보낸 등록 요청이 서버에 이미 처리되었을 수 있습니다. 먼저 등록 내역에서 확인하는 것이 안전합니다.\n내용을 그대로 두고 다시 등록하면 같은 요청으로 확인하므로 중복 등록되지 않습니다.',
    confirmText: '편집으로 돌아가기',
    cancelText: '취소',
  });
  if (ok) unlockUncertainSubmission();
}

async function confirmStartNew(): Promise<void> {
  const ok = await confirm({
    title: '새로 작성할까요?',
    message: '지금 작성 중인 거래처·메모·사진이 모두 지워지고 새 작성 건으로 시작합니다. 같은 EDI가 이미 등록되어 있지 않은지 먼저 등록 내역에서 확인해 주세요.',
    confirmText: '새로 작성하기',
    cancelText: '취소',
    tone: 'danger',
  });
  if (ok) resetDraft();
}

export function StepConfirm() {
  const limits = useLimits();
  const months = useEdiMonthOptions();
  const { client, targetYm, memo, photos, phase, submit, setStep } = useEdiDraft(
    useShallow((s) => ({
      client: s.client,
      targetYm: s.targetYm,
      memo: s.memo,
      photos: s.photos,
      phase: s.phase,
      submit: s.submit,
      setStep: s.setStep,
    })),
  );
  const [viewerId, setViewerId] = useState<string | null>(null);
  // 중복 탭 방지 (컨트롤러도 실행 중이면 무시하지만 버튼 상태가 바뀌기 전 연타를 막는다)
  const tapGuard = useRef(false);

  const locked = phase !== 'editing';
  const uncertain = phase === 'submitting' && submit.stage === 'uncertain';
  const busy = phase === 'submitting' && !uncertain;
  const summary = summarizeUploads(photos);
  const count = photos.length;
  const notice = submit.notice;
  const monthDisplay = months.data?.options.find((o) => o.ym === targetYm)?.display ?? formatYm(targetYm);
  const showProgress = busy || photos.some((p) => p.upload.state !== 'idle');
  const failedPhotos = photos.map((p, i) => ({ p, seq: i + 1 })).filter(({ p }) => p.upload.state === 'failed');
  const permanentFailures = failedPhotos.filter(({ p }) => p.upload.retryable === false);

  function run(action: () => Promise<void>) {
    if (tapGuard.current) return;
    tapGuard.current = true;
    void action().finally(() => {
      tapGuard.current = false;
    });
  }

  const submitNow = () => run(() => startSubmit({ minPhotos: limits.ediMinPhotos, maxPhotos: limits.ediMaxPhotos }));
  const retryUncertain = () => run(() => retryPendingSubmission());
  const conflict = !locked && notice?.kind === 'conflict';
  const serverError = uncertain && notice?.kind === 'uncertain' && notice.serverError === true;

  let primaryTitle = `사진 ${count}장 등록하기`;
  if (uncertain) primaryTitle = '다시 시도';
  else if (conflict) primaryTitle = '등록 내역 확인';
  else if (busy && submit.stage === 'creating') primaryTitle = '등록하는 중…';
  else if (busy) primaryTitle = `업로드 중 ${summary.uploaded} / ${summary.total}`;
  else if (notice?.kind === 'upload-failed' && summary.failed > 0) primaryTitle = '실패한 사진만 다시 시도';
  else if (notice?.kind === 'reupload') primaryTitle = '다시 등록하기';

  const viewerPhotos = photos.filter((p) => p.processed);
  const viewerIndex = viewerId ? viewerPhotos.findIndex((p) => p.localId === viewerId) : -1;

  return (
    <StepScaffold
      footer={
        <StepFooterRow>
          <Button title="이전" variant="secondary" size="lg" icon="arrow-back" onPress={() => setStep(2)} disabled={locked} style={styles.prev} />
          <Button
            title={primaryTitle}
            size="lg"
            icon={uncertain ? 'refresh' : conflict ? 'list-outline' : busy ? undefined : 'cloud-upload-outline'}
            onPress={uncertain ? retryUncertain : conflict ? openHistory : submitNow}
            loading={busy}
            disabled={busy || (count === 0 && !conflict)}
            style={styles.next}
          />
        </StepFooterRow>
      }
    >
      {uncertain ? (
        <Notice
          tone="warning"
          title="등록 결과를 확인하지 못했습니다"
          message={notice?.message}
          action={
            <>
              <Button title="등록 내역 확인" size="sm" variant="secondary" icon="list-outline" onPress={openHistory} />
              {serverError ? <Button title="편집으로 돌아가기" size="sm" variant="secondary" icon="create-outline" onPress={() => void confirmUnlock()} /> : null}
              <Button title="다시 시도" size="sm" icon="refresh" onPress={retryUncertain} />
            </>
          }
        />
      ) : null}
      {conflict ? (
        <Notice
          tone="warning"
          title="이미 등록되었을 수 있습니다"
          message={notice.message}
          action={
            <>
              <Button title="새로 작성하기" size="sm" variant="secondary" icon="add" onPress={() => void confirmStartNew()} />
              <Button title="등록 내역 확인" size="sm" icon="list-outline" onPress={openHistory} />
            </>
          }
        />
      ) : null}
      {!locked && notice?.kind === 'unlocked' ? (
        <Notice
          tone="warning"
          title="앞서 보낸 등록 결과를 아직 확인하지 못했습니다"
          message={notice.message}
          action={<Button title="등록 내역 확인" size="sm" variant="secondary" icon="list-outline" onPress={openHistory} />}
        />
      ) : null}
      {!locked && notice?.kind === 'upload-failed' ? (
        <Notice
          tone="danger"
          title={notice.message}
          message="업로드가 끝난 사진은 다시 보내지 않습니다. 연결 상태를 확인한 뒤 실패한 사진만 다시 시도해 주세요."
          action={summary.failed > 0 ? <Button title="실패한 사진만 다시 시도" size="sm" icon="refresh" onPress={submitNow} /> : null}
        >
          {permanentFailures.map(({ p, seq }) => (
            <Text key={p.localId} variant="caption" tone="danger">
              · {seq}번 {p.sourceName}: {p.upload.error} (이 사진은 이전 단계에서 제거해 주세요)
            </Text>
          ))}
        </Notice>
      ) : null}
      {!locked && notice?.kind === 'reupload' ? (
        <Notice tone="warning" title={`사진 ${notice.count}장을 다시 올려야 합니다`} message={notice.message} action={<Button title="다시 등록하기" size="sm" onPress={submitNow} />} />
      ) : null}
      {!locked && notice?.kind === 'rejected' ? <Notice tone="danger" title="등록하지 못했습니다" message={notice.message} /> : null}

      <Card style={styles.card}>
        <SectionTitle title="등록 내용 확인" description="아래 내용과 사진 순서대로 등록됩니다." />
        <View>
          <InfoRow label="거래처" value={client?.name ?? '선택되지 않음'} />
          <InfoRow label="대상 연월" value={monthDisplay || '선택되지 않음'} />
          <InfoRow label="메모" value={memo.trim() || null} />
          <InfoRow label="사진" value={`${count}장`} divider={false} />
        </View>
      </Card>

      <Card style={styles.card}>
        <SectionTitle title="등록 순서" description="번호 순서대로 저장됩니다. 순서를 바꾸려면 이전 단계로 돌아가세요." />
        <ThumbStrip photos={photos} onOpen={setViewerId} />
        {showProgress ? <UploadProgress summary={summary} stage={submit.stage} /> : null}
      </Card>

      {busy ? (
        <Text variant="caption" tone="secondary" align="center">
          등록이 끝날 때까지 앱을 종료하지 마세요. 다른 화면으로 이동해도 업로드는 계속됩니다.
        </Text>
      ) : null}

      <ImageViewerModal
        images={viewerPhotos.map((p) => ({ uri: p.processed?.uri ?? '', label: `${photos.indexOf(p) + 1}번 · ${p.sourceName}` }))}
        index={Math.max(0, viewerIndex)}
        visible={viewerIndex >= 0}
        onClose={() => setViewerId(null)}
        onIndexChange={(i) => setViewerId(viewerPhotos[i]?.localId ?? null)}
      />
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  prev: {
    flex: 1,
  },
  next: {
    flex: 2,
  },
});
