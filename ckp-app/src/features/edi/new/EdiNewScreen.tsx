/**
 * 새 EDI 등록 (3단계) — DESIGN §7.
 * 상태는 useEdiDraft(메모리)에 있어 탭을 옮겨도 유지된다. 업로드·제출은 화면 밖 컨트롤러(submit.ts)가 계속 진행한다.
 * 이탈 확인: 탭 이동(navigation-guard, 이 화면이 보이는 동안만) · 같은 스택 뒤로가기(usePreventRemove)
 *          · 웹 새로고침(beforeunload — submit.ts 가 작성 건 기준으로 화면 밖에서도 건다).
 */
import { useEffect } from 'react';
import { router, useNavigation, type Href } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useShallow } from 'zustand/react/shallow';

import { AppHeader, LoadingState, Screen, confirm, goBack, toast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useLeaveGuard } from '@/lib/navigation-guard';
import { layout, useIsWide } from '@/theme';
import { isForeignDraft, leaveMessage } from '../draft/progress';
import { ediDraftStore, useEdiDraft } from '../draft/store';
import type { DraftClient, DraftStep } from '../draft/types';
import { ensureDraftOwner, resetDraft } from './actions';
import { CompletionView } from './CompletionView';
import { StepBasic } from './StepBasic';
import { StepConfirm } from './StepConfirm';
import { STEP2_MAX_WIDTH_WIDE, StepPhotos } from './StepPhotos';
import { Stepper } from './Stepper';

const BACK_HREF: Href = '/edi';

export interface EdiNewScreenProps {
  /** 거래처 상세의 "이 거래처로 EDI 등록"에서 넘어온 거래처 */
  initialClient: DraftClient | null;
}

export function EdiNewScreen({ initialClient }: EdiNewScreenProps) {
  const { user } = useAuth();
  const usrId = user?.usrId ?? null;
  const wide = useIsWide();
  const navigation = useNavigation();

  const { ownerUsrId, phase, step, result, sample, replayed, setStep } = useEdiDraft(
    useShallow((s) => ({
      ownerUsrId: s.ownerUsrId,
      phase: s.phase,
      step: s.step,
      result: s.result,
      sample: s.sample,
      replayed: s.replayed,
      setStep: s.setStep,
    })),
  );
  const message = useEdiDraft((s) => leaveMessage(s));
  // 다른 사용자가 남긴 작성 건은 완료 결과까지 포함해 보여주지 않는다 (아래 effect 가 초기화하면 곧바로 풀린다)
  const foreignDraft = isForeignDraft(ownerUsrId, usrId);

  useEffect(() => {
    ensureDraftOwner(usrId);
  }, [usrId]);

  // 거래처 미리 선택 (주소 파라미터) — 한 번 적용한 뒤 파라미터를 지워 다시 적용되지 않게 한다
  const presetIdx = initialClient?.idx ?? null;
  const presetName = initialClient?.name ?? null;
  useEffect(() => {
    if (presetIdx === null || !presetName) return;
    const state = ediDraftStore.get();
    if (state.phase === 'submitting') {
      toast.info('등록이 진행 중이라 거래처를 바꾸지 않았습니다.');
    } else {
      if (state.phase === 'done') resetDraft();
      const current = ediDraftStore.get();
      if (!current.client || current.client.idx !== presetIdx) {
        if (current.client && current.photos.length > 0) {
          toast.info(`거래처를 ${presetName}(으)로 바꿨습니다. 선택한 사진은 그대로 유지됩니다.`);
        }
        current.setClient({ idx: presetIdx, name: presetName, selectable: null });
        current.setStep(1);
      }
    }
    router.setParams({ clientIdx: undefined, clientName: undefined });
  }, [presetIdx, presetName]);

  // 완료 화면을 떠나면(화면이 닫히면) 다음 방문 때 새 작성 건으로 시작한다
  useEffect(
    () => () => {
      if (ediDraftStore.get().phase === 'done') resetDraft();
    },
    [],
  );

  // 탭·사이드바·계정 버튼 이동 확인은 이 화면이 실제로 보일 때만 — 다른 탭에 마운트된 채 남아 있을 때는 묻지 않는다
  // (isFocused 는 부모 탭까지 확인한다. 작성 건은 메모리에 유지되고, 로그아웃 경고는 계정 화면이 따로 계산한다)
  useLeaveGuard('edi-new-draft', () => (navigation.isFocused() ? leaveMessage(ediDraftStore.get()) : null));
  usePreventRemove(message !== null, ({ data }) => {
    // 탭 바의 "같은 탭 다시 누르기"는 이미 confirmLeave() 로 확인했다
    if (data.action.type === 'POP_TO_TOP') {
      navigation.dispatch(data.action);
      return;
    }
    const text = leaveMessage(ediDraftStore.get());
    if (!text) {
      navigation.dispatch(data.action);
      return;
    }
    const submitting = ediDraftStore.get().phase === 'submitting';
    void confirm({
      title: '이 화면을 나갈까요?',
      message: text,
      confirmText: '나가기',
      cancelText: submitting ? '머무르기' : '계속 작성',
      tone: 'danger',
    }).then((ok) => {
      if (ok) navigation.dispatch(data.action);
    });
  });

  const header = <AppHeader title="새 EDI 등록" back backHref={BACK_HREF} maxWidth={step === 2 && wide ? STEP2_MAX_WIDTH_WIDE : layout.formMaxWidth} />;

  if (foreignDraft) {
    return (
      <Screen header={header}>
        <LoadingState label="작성 화면을 준비하는 중입니다…" />
      </Screen>
    );
  }

  if (phase === 'done' && result) {
    return (
      <CompletionView
        result={result}
        sample={!!sample}
        replayed={!!replayed}
        onNew={() => resetDraft()}
        onBack={() => goBack(BACK_HREF)}
      />
    );
  }

  const locked = phase !== 'editing';
  const onStepPress = locked ? undefined : (s: DraftStep) => setStep(s);

  return (
    <Screen header={header} padded={false} maxWidth={null}>
      <Stepper step={step} onStepPress={onStepPress} maxWidth={step === 2 && wide ? STEP2_MAX_WIDTH_WIDE : layout.formMaxWidth} />
      {step === 1 ? <StepBasic /> : step === 2 ? <StepPhotos /> : <StepConfirm />}
    </Screen>
  );
}
