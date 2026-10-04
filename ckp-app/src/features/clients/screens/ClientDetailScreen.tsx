/** 거래처 상세 (DESIGN §6.5): 값이 있는 항목만 표시 · 승인 안내 · '이 거래처로 EDI 등록' */
import { useState, type ReactNode } from 'react';
import { Linking, RefreshControl, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormScroll,
  InfoRow,
  Screen,
  SkeletonRows,
  Text,
  goBack,
  toast,
} from '@/components/ui';
import { ApiError, type ClientDetail } from '@/lib/api';
import { useFeatures } from '@/lib/auth';
import { hasValue, onlyDigits } from '@/lib/format';
import { colors, layout, spacing, useIsWide } from '@/theme';
import { APPROVAL_PENDING_EDI_MESSAGE, unselectableReason } from '../approval';
import { ClientApprovalBadge } from '../ClientApprovalBadge';
import { Notice } from '../Notice';
import { parseClientIdx, useClientDetail } from '../queries';

export function ClientDetailScreen() {
  const params = useLocalSearchParams<{ idx: string }>();
  const idx = parseClientIdx(params.idx);
  const detail = useClientDetail(idx);
  const [pulling, setPulling] = useState(false);
  const client = detail.data?.client;

  const header = <AppHeader title="거래처 상세" back backHref="/clients" maxWidth={layout.formMaxWidth} />;
  const notFound = idx === null || (detail.error instanceof ApiError && detail.error.status === 404);

  async function refresh() {
    setPulling(true);
    try {
      await detail.refetch();
    } finally {
      setPulling(false);
    }
  }

  if (notFound) {
    return (
      <Screen header={header} scroll maxWidth={layout.formMaxWidth}>
        <EmptyState
          icon="business-outline"
          title="거래처를 찾을 수 없습니다"
          description="삭제되었거나 내 거래처가 아닐 수 있습니다."
          actionLabel="거래처 목록"
          actionIcon="list"
          onAction={() => goBack('/clients')}
        />
      </Screen>
    );
  }

  if (!client) {
    return (
      <Screen header={header} scroll maxWidth={layout.formMaxWidth}>
        {detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isRefetching} />
        ) : (
          <View accessibilityLabel="거래처 정보를 불러오는 중입니다" accessibilityRole="progressbar">
            <SkeletonRows count={2} />
          </View>
        )}
      </Screen>
    );
  }

  // navigate: EDI 탭에서 새 등록 화면이 이미 맨 위면 그 화면에 거래처만 넘긴다(빠른 연타에도 작성 화면이 두 개 쌓이지 않게)
  const startEdi = () =>
    router.navigate({ pathname: '/edi/new', params: { clientIdx: client.idx, clientName: client.name } });

  return (
    <Screen header={header} padded={false} maxWidth={null}>
      <FormScroll
        footer={
          client.selectableForEdi ? (
            <Button title="이 거래처로 EDI 등록" icon="document-attach-outline" size="lg" fullWidth onPress={startEdi} />
          ) : undefined
        }
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void refresh()} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        <ClientSummaryCard client={client} />
        <ClientInfoCard client={client} />
      </FormScroll>
    </Screen>
  );
}

function ClientSummaryCard({ client }: { client: ClientDetail }) {
  const wide = useIsWide();
  const features = useFeatures();
  const pending = client.approval === 'pending';

  let notice: ReactNode = null;
  if (pending && (!client.selectableForEdi || features.clientApprovalRequiredForEdi)) {
    notice = <Notice tone="accent" title="관리자 승인 대기 중" message={APPROVAL_PENDING_EDI_MESSAGE} />;
  } else if (pending) {
    notice = <Notice tone="info" message="관리자 승인 대기 중인 거래처입니다. EDI 등록에는 사용할 수 있습니다." />;
  } else if (!client.selectableForEdi) {
    notice = <Notice tone="accent" message={unselectableReason(client) ?? ''} />;
  }

  function call() {
    const digits = onlyDigits(client.phone);
    if (!digits) return;
    Linking.openURL(`tel:${digits}`).catch(() => toast.error('이 기기에서는 전화를 걸 수 없습니다.'));
  }

  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <Text variant="title" selectable style={styles.flex} role="heading">
          {client.name}
        </Text>
        <ClientApprovalBadge approval={client.approval} size="md" />
      </View>
      {client.representative || client.clientType ? (
        <Text variant="secondary" tone="secondary">
          {[client.clientType, client.representative ? `대표 ${client.representative}` : null].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      {notice}
      {client.phone && !wide ? (
        <View style={styles.actions}>
          <Button title="전화 걸기" icon="call-outline" variant="soft" size="sm" onPress={call} accessibilityLabel={`${client.phone}로 전화 걸기`} />
        </View>
      ) : null}
    </Card>
  );
}

function ClientInfoCard({ client }: { client: ClientDetail }) {
  const rows: { label: string; value: string | null }[] = [
    { label: '거래처 구분', value: client.clientType },
    { label: '사업자등록번호', value: client.bizNo },
    { label: '대표자명', value: client.representative },
    { label: '연락처', value: client.phone },
    { label: '우편번호', value: client.zipCode },
    { label: '주소', value: client.address },
    { label: '요양기관번호', value: client.careCode },
    { label: '문전약국', value: client.dispensary },
    { label: '메모', value: client.memo },
    { label: '담당자', value: client.ownerUsrId },
  ].filter((row) => hasValue(row.value));

  return (
    <Card style={styles.infoCard}>
      <Text variant="heading" role="heading" style={styles.infoTitle}>
        거래처 정보
      </Text>
      {rows.length ? (
        rows.map((row, i) => <InfoRow key={row.label} label={row.label} value={row.value} divider={i < rows.length - 1} />)
      ) : (
        <Text variant="secondary" tone="muted" style={styles.infoEmpty}>
          등록된 상세 정보가 없습니다.
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  card: {
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  infoCard: {
    paddingVertical: spacing.sm,
  },
  infoTitle: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  infoEmpty: {
    paddingVertical: spacing.md,
  },
});
