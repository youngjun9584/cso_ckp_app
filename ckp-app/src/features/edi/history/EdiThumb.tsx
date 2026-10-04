import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { Icon, Text } from '@/components/ui';
import { getApi } from '@/lib/api';
import { colors } from '@/theme';

export interface EdiThumbProps {
  /** 서버가 준 URL(서명 URL·상대 경로 모두 가능) */
  uri: string | null | undefined;
  style?: StyleProp<ViewStyle>;
  iconSize?: number;
  /** 불러오기 실패 시 문구를 함께 보여줄지 (작은 썸네일은 아이콘만) */
  showErrorText?: boolean;
  /** 불러오기 실패 — 만료된 서명 URL 이면 상위에서 데이터를 다시 받는다 */
  onError?: () => void;
}

/** EDI 사진 썸네일. URL 이 없거나 불러오지 못하면 회색 자리표시를 보여준다. */
export function EdiThumb({ uri, style, iconSize = 22, showErrorText = false, onError }: EdiThumbProps) {
  const resolved = getApi().resolveUrl(uri);
  // 실패한 URL 을 기억한다 — 새 URL(재발급)이 오면 자동으로 다시 시도된다
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const failed = resolved !== null && failedUri === resolved;

  if (!resolved || failed) {
    return (
      <View style={[styles.box, styles.placeholder, style]}>
        <Icon name={failed ? 'alert-circle-outline' : 'image-outline'} size={iconSize} color={colors.textMuted} />
        {failed && showErrorText ? (
          <Text variant="caption" tone="muted" align="center">
            사진을 불러오지 못했습니다
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.box, style]}>
      <Image
        source={{ uri: resolved }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={120}
        recyclingKey={resolved}
        accessible={false}
        onError={() => {
          setFailedUri(resolved);
          onError?.();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    overflow: 'hidden',
    backgroundColor: colors.divider,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 4,
  },
});
