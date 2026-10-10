/** 의약품 목록용 제품 사진 썸네일 — 사진이 없거나 불러오지 못하면 기본 아이콘 자리표시 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { Icon } from '@/components/ui';
import { getApi } from '@/lib/api';
import { colors, radius } from '@/theme';

export interface MedicineThumbProps {
  imageUrl: string | null | undefined;
  /** 한 변 길이(px) */
  size?: number;
}

export function MedicineThumb({ imageUrl, size = 56 }: MedicineThumbProps) {
  const [failed, setFailed] = useState(false);
  const uri = getApi().resolveUrl(imageUrl);
  const showImage = !!uri && !failed;

  return (
    <View style={[styles.box, { width: size, height: size }]} aria-hidden>
      {showImage ? (
        <Image source={{ uri }} style={styles.image} contentFit="contain" transition={120} onError={() => setFailed(true)} />
      ) : (
        <Icon name="medkit-outline" size={Math.round(size * 0.45)} color={colors.textMuted} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.primarySoft,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
