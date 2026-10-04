/**
 * 1단계 기본 정보: 거래처(내 거래처, 선택 불가 항목은 흐리게) · 대상 연월(month-options, 기본 당월) · 메모(500자).
 * EDI 가 관리자에 의해 막혀 있으면 경고를 보여주고 다음 단계로 갈 수 없다.
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';

import { Button, Card, ErrorState, SectionTitle, Text, TextField } from '@/components/ui';
import { ClientPicker } from '@/features/clients';
import { getApi } from '@/lib/api';
import { useLimits } from '@/lib/auth';
import { spacing } from '@/theme';
import { hasErrors, validateStep1 } from '../draft/progress';
import { useEdiDraft } from '../draft/store';
import { MonthOptions } from './MonthOptions';
import { Notice } from './Notice';
import { useEdiMonthOptions, useEdiStatus } from './queries';
import { StepFooterRow } from './StepFooter';
import { StepScaffold } from './StepScaffold';

export function StepBasic() {
  const limits = useLimits();
  const { client, memo, targetYm, phase, notice, setClient, setMemo, setTargetYm, setStep, setSubmit } = useEdiDraft(
    useShallow((s) => ({
      client: s.client,
      memo: s.memo,
      targetYm: s.targetYm,
      phase: s.phase,
      notice: s.submit.notice,
      setClient: s.setClient,
      setMemo: s.setMemo,
      setTargetYm: s.setTargetYm,
      setStep: s.setStep,
      setSubmit: s.setSubmit,
    })),
  );
  const locked = phase !== 'editing';
  const status = useEdiStatus();
  const months = useEdiMonthOptions();
  const [attempted, setAttempted] = useState(false);

  // 주소 파라미터로 들어온 거래처는 선택 가능 여부를 모른다 → 상세 조회로 확인
  const needsCheck = !!client && client.selectable === null;
  const clientCheck = useQuery({
    queryKey: ['edi', 'client-check', client?.idx ?? 0],
    queryFn: ({ signal }) => getApi().getClient(client?.idx ?? 0, { signal }),
    enabled: needsCheck,
    staleTime: 30_000,
  });
  const selectable = client ? (client.selectable ?? clientCheck.data?.client.selectableForEdi ?? null) : null;

  const options = months.data?.options ?? [];
  const defaultYm = options.find((o) => o.label === months.data?.defaultLabel)?.ym ?? options[0]?.ym ?? null;
  const storedValid = !!targetYm && options.some((o) => o.ym === targetYm);
  const effectiveYm = storedValid ? targetYm : defaultYm;
  const monthChanged = !!targetYm && options.length > 0 && !storedValid;

  const errors = validateStep1({ client: client ? { ...client, selectable } : null, memo }, effectiveYm, limits.memoMaxLength);
  const disabledByStatus = status.data?.enabled === false;
  const ready = !!status.data?.enabled && options.length > 0;

  function onNext() {
    setAttempted(true);
    if (!ready || hasErrors(errors) || !client || !effectiveYm) return;
    if (client.selectable !== selectable) setClient({ ...client, selectable });
    setTargetYm(effectiveYm);
    if (notice?.kind === 'rejected') setSubmit({ notice: null });
    setStep(2);
  }

  const nextLabel = status.isPending || months.isPending ? '확인 중…' : '다음 · 사진 선택';

  return (
    <StepScaffold
      footer={
        <StepFooterRow>
          <Button
            title={nextLabel}
            size="lg"
            iconRight="arrow-forward"
            fullWidth
            onPress={onNext}
            loading={status.isPending || months.isPending}
            disabled={locked || disabledByStatus || status.isError || months.isError}
            style={styles.flex}
          />
        </StepFooterRow>
      }
    >
      {notice?.kind === 'rejected' ? <Notice tone="danger" title="등록하지 못했습니다" message={notice.message} /> : null}

      {disabledByStatus ? (
        <Notice
          tone="warning"
          title="지금은 EDI를 등록할 수 없습니다"
          message={status.data?.message || '관리자가 EDI 등록을 일시적으로 막아 두었습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.'}
          action={<Button title="다시 확인" size="sm" variant="secondary" icon="refresh" onPress={() => void status.refetch()} loading={status.isFetching} />}
        />
      ) : null}
      {status.isError ? (
        <ErrorState
          compact
          error={status.error}
          title="EDI 등록 가능 여부를 확인하지 못했습니다"
          onRetry={() => void status.refetch()}
          retrying={status.isFetching}
        />
      ) : null}

      <Card style={styles.card}>
        <SectionTitle title="거래처" description="EDI를 등록할 내 거래처를 선택하세요." />
        <ClientPicker
          label=""
          required
          value={client ? { idx: client.idx, name: client.name } : null}
          onChange={(c) => setClient({ idx: c.idx, name: c.name, selectable: c.selectableForEdi })}
          error={attempted || selectable === false ? errors.client : null}
          disabled={locked}
        />
        {needsCheck && clientCheck.isPending ? (
          <Text variant="caption" tone="secondary">
            거래처 정보를 확인하는 중입니다…
          </Text>
        ) : null}
      </Card>

      <Card style={styles.card}>
        <SectionTitle title="대상 연월" description="처방·거래 기준 월을 선택하세요. 기본은 당월입니다." />
        {months.isError ? (
          <ErrorState compact error={months.error} title="대상 연월을 불러오지 못했습니다" onRetry={() => void months.refetch()} retrying={months.isFetching} />
        ) : (
          <MonthOptions options={options} value={effectiveYm} onChange={setTargetYm} disabled={locked} loading={months.isPending} />
        )}
        {monthChanged ? (
          <Text variant="caption" tone="warning">
            날짜가 바뀌어 선택할 수 있는 연월이 달라졌습니다. 기본값으로 다시 골랐으니 확인해 주세요.
          </Text>
        ) : null}
        {attempted && errors.targetYm ? (
          <Text variant="secondary" tone="danger" accessibilityLiveRegion="polite">
            {errors.targetYm}
          </Text>
        ) : null}
      </Card>

      <Card style={styles.card}>
        <TextField
          label="메모 (선택)"
          placeholder="전달할 내용이 있으면 입력하세요"
          helper="메모는 등록 내역에서 확인할 수 있습니다."
          multiline
          maxLength={limits.memoMaxLength}
          showCounter
          value={memo}
          onChangeText={setMemo}
          editable={!locked}
          error={attempted ? errors.memo : null}
          inputStyle={styles.memo}
        />
      </Card>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  card: {
    gap: spacing.md,
  },
  memo: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
});
