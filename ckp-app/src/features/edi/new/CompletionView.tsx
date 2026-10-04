/**
 * 완료 화면 (201/200 수신 후에만): 거래처·대상월·사진 N장 + **서버가 돌려준 순서**(seq) 썸네일 + [등록 내역 보기] [새 EDI 등록].
 * 샘플 모드면 실제 저장이라고 말하지 않는다.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';

import { AppHeader, Button, Card, Icon, ImageViewerModal, InfoRow, Screen, SectionTitle, Text } from '@/components/ui';
import { getApi, type EdiSubmissionDetail } from '@/lib/api';
import { formatDateTimeShort, formatYm } from '@/lib/kst';
import { colors, layout, radius, spacing, useIsWide } from '@/theme';
import { Notice } from './Notice';

export interface CompletionViewProps {
  result: EdiSubmissionDetail;
  sample: boolean;
  replayed: boolean;
  onNew: () => void;
  onBack: () => void;
}

export function CompletionView({ result, sample, replayed, onNew, onBack }: CompletionViewProps) {
  const api = getApi();
  const wide = useIsWide();
  const { width } = useWindowDimensions();
  const columns = wide ? 6 : width >= 600 ? 5 : 4;
  const photos = [...result.photos].sort((a, b) => a.seq - b.seq);
  const [viewer, setViewer] = useState<number | null>(null);
  const viewable = photos.filter((p) => p.imageUrl || p.thumbUrl);

  const month = [result.monthLabel, result.targetYm ? formatYm(result.targetYm) : null].filter(Boolean).join(' · ');

  return (
    <Screen header={<AppHeader title="EDI 등록 결과" back={onBack} maxWidth={layout.formMaxWidth} />} scroll maxWidth={layout.formMaxWidth}>
      <View style={styles.stack}>
        <Card style={styles.hero}>
          <View style={[styles.heroIcon, sample ? styles.heroIconSample : styles.heroIconDone]}>
            <Icon name={sample ? 'flask-outline' : 'checkmark-circle'} size={40} color={sample ? colors.accentText : colors.success} />
          </View>
          <Text variant="titleLg" align="center" role="heading" accessibilityLiveRegion="polite">
            {sample ? '샘플 모드: 실제 서버에 저장되지 않았습니다' : 'EDI 등록이 완료되었습니다'}
          </Text>
          <Text variant="body" tone="secondary" align="center">
            {sample
              ? '샘플 데이터로 등록 과정을 흉내 냈습니다. 앱을 다시 시작하면 이 내역은 사라집니다.'
              : `사진 ${result.photoCount}장이 아래 순서대로 저장되었습니다.`}
          </Text>
        </Card>

        {replayed ? <Notice tone="info" message="이미 처리된 등록 요청이어서 기존 등록 결과를 보여 드립니다. 중복으로 등록되지 않았습니다." /> : null}

        <Card>
          <InfoRow label="거래처" value={result.clientName} />
          <InfoRow label="대상 연월" value={month || null} />
          <InfoRow label="사진" value={`${result.photoCount}장`} />
          <InfoRow label="메모" value={result.memo} />
          <InfoRow label="등록 시각" value={formatDateTimeShort(result.createdAt)} divider={false} />
        </Card>

        <Card style={styles.photosCard}>
          <SectionTitle
            title={sample ? '등록 사진 순서' : '저장된 사진 순서'}
            description={sample ? '샘플 모드에서 흉내 낸 순서입니다(실제 서버 저장 아님).' : '서버에 저장된 순서입니다.'}
          />
          <View style={styles.grid}>
            {photos.map((photo) => {
              const uri = api.resolveUrl(photo.thumbUrl ?? photo.imageUrl);
              const index = viewable.indexOf(photo);
              return (
                <Pressable
                  key={photo.seq}
                  onPress={() => (index >= 0 ? setViewer(index) : undefined)}
                  disabled={index < 0}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`${photo.seq}번 사진 크게 보기`}
                  style={[styles.cell, { width: `${100 / columns}%` }]}
                >
                  <View style={styles.thumb}>
                    {uri ? (
                      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} />
                    ) : (
                      <Icon name="image-outline" size={22} color={colors.textMuted} />
                    )}
                    <View style={styles.seq}>
                      <Text variant="caption" color={colors.white} weight="bold">
                        {photo.seq}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <View style={[styles.buttons, wide && styles.buttonsWide]}>
          {/* 완료된 작성 화면을 상세로 바꿔 끼운다(push 하면 완료 화면이 스택 아래에 남아 나중에 새 작성 화면이 두 개 쌓일 수 있다) */}
          <Button title="등록 내역 보기" size="lg" icon="list-outline" onPress={() => router.replace({ pathname: '/edi/[id]', params: { id: result.id } })} style={styles.flex} />
          <Button title="새 EDI 등록" size="lg" variant="secondary" icon="add" onPress={onNew} style={styles.flex} />
        </View>
      </View>

      <ImageViewerModal
        images={viewable.map((p) => ({ uri: api.resolveUrl(p.imageUrl ?? p.thumbUrl) ?? '', label: `${p.seq}번 사진` }))}
        index={viewer ?? 0}
        visible={viewer !== null}
        onClose={() => setViewer(null)}
        onIndexChange={setViewer}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconDone: {
    backgroundColor: colors.successSoft,
  },
  heroIconSample: {
    backgroundColor: colors.accentSoft,
  },
  photosCard: {
    gap: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs,
  },
  cell: {
    padding: spacing.xs,
  },
  thumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.control,
    overflow: 'hidden',
    backgroundColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seq: {
    position: 'absolute',
    top: 4,
    left: 4,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 5,
    borderRadius: 12,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttons: {
    gap: spacing.sm,
  },
  buttonsWide: {
    flexDirection: 'row',
  },
  flex: {
    flexGrow: 1,
  },
});
