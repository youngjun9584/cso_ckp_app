import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import Constants from 'expo-constants';

import {
  AppHeader,
  Badge,
  Button,
  Card,
  ErrorState,
  InfoRow,
  Screen,
  SectionTitle,
  Text,
  confirm,
  toast,
  type BadgeTone,
} from '@/components/ui';
import { signOutWarning } from '@/features/edi/draft/progress';
import { ediDraftStore } from '@/features/edi/draft/store';
import { sampleSettings, useSampleSettings } from '@/lib/api/sample';
import { useAuth, useDataSource, useMeta, type DataSourceKind } from '@/lib/auth';
import { config } from '@/lib/config';
import { colors, spacing, useIsWide } from '@/theme';

const SOURCE_TONE: Record<DataSourceKind, BadgeTone> = {
  sample: 'accent',
  development: 'teal',
  production: 'success',
  unknown: 'neutral',
};

export default function AccountScreen() {
  const wide = useIsWide();
  const { user, signOut } = useAuth();
  const meta = useMeta();
  const source = useDataSource();
  const sample = useSampleSettings();
  const [signingOut, setSigningOut] = useState(false);

  async function logout() {
    // EDI 작성 건은 작성 화면을 떠나 있어도 메모리에 남아 있고, 로그아웃하면 버려진다 → 작성 건 상태로 직접 확인
    const pending = signOutWarning(ediDraftStore.get());
    const ok = await confirm({
      title: '로그아웃할까요?',
      message: pending ?? '다시 이용하려면 아이디와 비밀번호로 로그인해야 합니다.',
      confirmText: '로그아웃',
      tone: 'danger',
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      await signOut();
      toast.info('로그아웃되었습니다.');
    } finally {
      setSigningOut(false);
    }
  }

  const storage = meta.data?.storage === 's3' ? '객체 저장소(S3)' : meta.data?.storage === 'local' ? '서버 로컬 디스크(개발용)' : null;

  return (
    <Screen header={<AppHeader title="계정" back={!wide} backHref="/home" maxWidth={720} />} scroll maxWidth={720}>
      <View style={styles.stack}>
        <Card>
          <View style={styles.profile}>
            <View style={styles.avatar}>
              <Text variant="title" color={colors.white}>
                {(user?.name ?? user?.usrId ?? '?').slice(0, 1)}
              </Text>
            </View>
            <View style={styles.flex}>
              <Text variant="heading">{user?.name ?? user?.usrId}</Text>
              <Text variant="secondary" tone="secondary">
                {user?.companyName ?? '소속 정보 없음'}
              </Text>
            </View>
          </View>
          <View style={styles.rows}>
            <InfoRow label="아이디" value={user?.usrId} />
            <InfoRow label="이름" value={user?.name} />
            <InfoRow label="회사" value={user?.companyName} />
            <InfoRow label="연락처" value={user?.phone} />
            <InfoRow label="이메일" value={user?.email} divider={false} />
          </View>
        </Card>

        <SectionTitle title="연결 정보" />
        <Card>
          <InfoRow label="데이터">
            <Badge label={source.label} tone={SOURCE_TONE[source.kind]} size="md" />
          </InfoRow>
          <InfoRow label="API 주소" value={config.apiBaseUrl ?? '없음 (앱 안의 샘플 데이터 사용)'} />
          <InfoRow label="API 버전" value={meta.data?.apiVersion} />
          <InfoRow label="사진 저장소" value={config.apiMode === 'live' ? storage : null} />
          <InfoRow label="서버 시각" value={config.apiMode === 'live' ? meta.data?.serverTime : null} />
          <InfoRow label="앱 버전" value={Constants.expoConfig?.version ?? null} divider={false} />
          {meta.isError ? (
            <ErrorState compact error={meta.error} title="서버 정보를 확인하지 못했습니다" onRetry={() => void meta.refetch()} retrying={meta.isFetching} />
          ) : null}
        </Card>

        {config.apiMode === 'sample' ? (
          <>
            <SectionTitle title="샘플 모드 설정" description="샘플 모드에서만 보이는 시험용 설정입니다. 앱을 다시 시작하면 초기화됩니다." />
            <Card padded={false}>
              <SwitchRow
                title="업로드 실패 흉내"
                description="새 사진 3장 중 1장꼴로 업로드가 실패합니다. 실패한 사진을 다시 보내면 성공합니다."
                value={sample.simulateUploadFailure}
                onValueChange={(v) => sampleSettings.set({ simulateUploadFailure: v })}
                divider
              />
              <SwitchRow
                title="EDI 등록 차단 흉내"
                description="관리자가 EDI 등록을 막아 둔 상태를 확인할 수 있습니다."
                value={sample.simulateEdiDisabled}
                onValueChange={(v) => sampleSettings.set({ simulateEdiDisabled: v })}
              />
            </Card>
          </>
        ) : null}

        <Button title="로그아웃" variant="secondary" icon="log-out-outline" fullWidth loading={signingOut} onPress={() => void logout()} />
      </View>
    </Screen>
  );
}

interface SwitchRowProps {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  divider?: boolean;
}

function SwitchRow({ title, description, value, onValueChange, divider }: SwitchRowProps) {
  return (
    <View style={[styles.switchRow, divider && styles.divider]}>
      <View style={styles.flex}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="secondary" tone="secondary">
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={title}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor={colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
  flex: {
    flex: 1,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rows: {
    marginTop: spacing.xs,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
