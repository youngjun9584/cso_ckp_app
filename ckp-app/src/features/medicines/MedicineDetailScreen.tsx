/**
 * 의약품 상세 (DESIGN §2.3·§6.5): 값이 있는 항목만 보여 준다 (빈 행·빈 섹션은 숨김).
 * 섹션: 기본 정보 / 가격·정산 / 성분·분류 / 비고. 넓은 화면은 가운데 최대 880.
 */
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import {
  AppHeader,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ImageViewerModal,
  InfoRow,
  Screen,
  SectionTitle,
  Skeleton,
  Text,
  goBack,
} from '@/components/ui';
import { getApi, type MedicineDetail } from '@/lib/api';
import { useFeatures } from '@/lib/auth';
import { hasValue } from '@/lib/format';
import { colors, radius, spacing, useIsWide } from '@/theme';
import { formatDotDate, medicinePrice, settlementLabel } from './format';
import { isNotFoundError, useMedicineDetail } from './queries';

const MAX_WIDTH = 880;

type Row = [label: string, value: string | null | undefined];

function presentRows(rows: Row[]): Row[] {
  return rows.filter(([, value]) => hasValue(value));
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={styles.section}>
      <SectionTitle title={title} />
      <View>{children}</View>
    </Card>
  );
}

function RowsSection({ title, rows, labelWidth }: { title: string; rows: Row[]; labelWidth: number }) {
  const visible = presentRows(rows);
  if (visible.length === 0) return null;
  return (
    <DetailSection title={title}>
      {visible.map(([label, value], i) => (
        <InfoRow key={label} label={label} value={value} labelWidth={labelWidth} divider={i < visible.length - 1} />
      ))}
    </DetailSection>
  );
}

interface Metric {
  label: string;
  value: string;
  tone: 'primary' | 'accent' | 'success' | 'neutral';
}

const METRIC_COLORS: Record<Metric['tone'], { bg: string; fg: string }> = {
  primary: { bg: colors.primarySoft, fg: colors.primaryStrong },
  accent: { bg: colors.accentSoft, fg: colors.accentText },
  success: { bg: colors.successSoft, fg: colors.success },
  neutral: { bg: colors.divider, fg: colors.textSecondary },
};

function MetricTile({ label, value, tone }: Metric) {
  const c = METRIC_COLORS[tone];
  return (
    <View style={[styles.metric, { backgroundColor: c.bg }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="caption" color={c.fg}>
        {label}
      </Text>
      <Text variant="heading" color={c.fg} selectable>
        {value}
      </Text>
    </View>
  );
}

/** 불러온 의약품 상세를 그린다 */
export function MedicineDetailBody({ medicine, showFee }: { medicine: MedicineDetail; showFee: boolean }) {
  const wide = useIsWide();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imageUri = getApi().resolveUrl(medicine.imageUrl);
  const showImage = !!imageUri && !imageFailed;
  const labelWidth = wide ? 140 : 112;

  const price = medicinePrice(medicine);
  const fee = showFee ? medicine.fee : null;
  const settlement = settlementLabel(medicine.settlement);
  const metrics: Metric[] = [];
  if (price) metrics.push({ label: '약가', value: price, tone: 'primary' });
  if (fee && hasValue(fee.value)) metrics.push({ label: fee.label || '수수료', value: fee.value, tone: 'accent' });
  if (settlement) {
    const tone = medicine.settlement?.trim().toUpperCase() === 'Y' ? 'success' : 'neutral';
    metrics.push({ label: '정산 여부', value: settlement, tone });
  }

  const type1 = medicine.type1?.trim();
  const type2 = medicine.type2?.trim();
  const note = medicine.note?.trim();
  const badges: { label: string; tone: 'teal' | 'primary' | 'neutral' }[] = [];
  if (medicine.inHouse) badges.push({ label: '자사생산', tone: 'teal' });
  if (type1) badges.push({ label: type1, tone: 'primary' });
  if (type2 && type2 !== type1) badges.push({ label: type2, tone: 'neutral' });

  return (
    <View style={styles.stack}>
      <Card style={[styles.hero, wide && styles.heroWide]}>
        {showImage ? (
          <Pressable
            onPress={() => setViewerOpen(true)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${medicine.name} 제품 사진 크게 보기`}
            style={[styles.imageBox, wide && styles.imageBoxWide]}
          >
            <Image
              source={{ uri: imageUri }}
              style={styles.image}
              contentFit="contain"
              transition={120}
              onError={() => setImageFailed(true)}
            />
            <View style={styles.zoomHint}>
              <Icon name="expand-outline" size={14} color={colors.white} />
            </View>
          </Pressable>
        ) : null}
        <View style={styles.heroText}>
          {badges.length > 0 ? (
            <View style={styles.badges}>
              {badges.map((b) => (
                <Badge key={b.label} label={b.label} tone={b.tone} size="md" />
              ))}
            </View>
          ) : null}
          <Text variant={wide ? 'titleLg' : 'title'} selectable role="heading">
            {medicine.name}
          </Text>
          <Text variant="secondary" tone="secondary" selectable>
            {[medicine.company, `보험코드 ${medicine.code}`].filter(hasValue).join(' · ')}
          </Text>
        </View>
      </Card>

      <RowsSection
        title="기본 정보"
        labelWidth={labelWidth}
        rows={[
          ['제약사', medicine.company],
          ['보험코드', medicine.code],
          ['포장·규격', medicine.packing],
          ['자사생산', medicine.inHouse ? '자사생산 품목' : null],
          ['등록일', formatDotDate(medicine.regYmd)],
        ]}
      />

      {metrics.length > 0 ? (
        <DetailSection title="가격·정산">
          <View style={styles.metrics}>
            {metrics.map((m) => (
              <MetricTile key={m.label} {...m} />
            ))}
          </View>
        </DetailSection>
      ) : null}

      <RowsSection
        title="성분·분류"
        labelWidth={labelWidth}
        rows={[
          ['성분 및 함량', medicine.ingredient],
          ['구분 1', medicine.type1],
          ['구분 2', medicine.type2],
          ['복지부 분류', medicine.medicineClass],
          ['복지부 코드', medicine.welfareCode],
          ['대조의약품', medicine.contrastMedicine],
          ['첨가제', medicine.additives],
        ]}
      />

      {note ? (
        <DetailSection title="비고">
          <Text variant="body" selectable style={styles.note}>
            {note}
          </Text>
        </DetailSection>
      ) : null}

      {showImage ? (
        <ImageViewerModal
          images={[{ uri: imageUri, label: medicine.name }]}
          index={0}
          visible={viewerOpen}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </View>
  );
}

function DetailSkeleton() {
  return (
    <View style={styles.stack} accessibilityRole="progressbar" accessibilityLabel="의약품 정보를 불러오는 중입니다" aria-busy>
      <Card style={styles.skeletonCard}>
        <Skeleton width={96} height={22} radius={radius.pill} />
        <Skeleton width="70%" height={24} />
        <Skeleton width="45%" height={14} />
      </Card>
      {[0, 1].map((i) => (
        <Card key={i} style={styles.skeletonCard}>
          <Skeleton width={88} height={18} />
          <Skeleton width="90%" height={14} />
          <Skeleton width="80%" height={14} />
          <Skeleton width="60%" height={14} />
        </Card>
      ))}
    </View>
  );
}

export function MedicineDetailScreen({ code }: { code: string }) {
  const showFee = useFeatures().medicineFeeVisible;
  const detail = useMedicineDetail(code);
  const medicine = detail.data?.medicine;

  let content: ReactNode;
  if (!code || (detail.isError && isNotFoundError(detail.error))) {
    content = (
      <EmptyState
        icon="medkit-outline"
        title="의약품을 찾을 수 없습니다."
        description="삭제되었거나 보험코드가 바뀌었을 수 있습니다. 목록에서 다시 찾아 주세요."
        actionLabel="의약품 목록으로"
        actionIcon="list"
        onAction={() => goBack('/medicines')}
      />
    );
  } else if (medicine) {
    content = <MedicineDetailBody key={medicine.code} medicine={medicine} showFee={showFee} />;
  } else if (detail.isError) {
    content = <ErrorState error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />;
  } else {
    content = <DetailSkeleton />;
  }

  return (
    <Screen
      header={<AppHeader title="의약품 상세" back backHref="/medicines" maxWidth={MAX_WIDTH} />}
      scroll
      maxWidth={MAX_WIDTH}
    >
      {content}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
  },
  heroWide: {
    gap: spacing.xxl,
  },
  heroText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  imageBox: {
    width: 88,
    height: 88,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  imageBoxWide: {
    width: 128,
    height: 128,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  zoomHint: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,35,66,0.55)',
  },
  section: {
    gap: spacing.sm,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  metric: {
    flexGrow: 1,
    flexBasis: 96,
    borderRadius: radius.control,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: 2,
  },
  note: {
    paddingTop: spacing.xs,
  },
  skeletonCard: {
    gap: spacing.md,
  },
});
