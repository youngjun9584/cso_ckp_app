/**
 * 전체 화면 사진 확대 보기.
 * - 좌우 넘기기(스와이프), 화살표 버튼, 웹 키보드 ←/→, Esc(닫기)
 * - 두 손가락 확대/이동, 두 번 탭(더블클릭) 확대, 확대 버튼
 * - 상단에 '3 / 12' 순번과 라벨, 닫기 버튼
 */
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, radius, spacing } from '@/theme';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface ViewerImage {
  uri: string;
  /** 상단에 함께 보여줄 설명 (예: 파일명) */
  label?: string;
}

export interface ImageViewerModalProps {
  images: ViewerImage[];
  /** 처음 보여줄 사진 (0부터) */
  index: number;
  visible: boolean;
  onClose: () => void;
  /** 사용자가 다른 사진으로 넘겼을 때 */
  onIndexChange?: (index: number) => void;
}

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

export function ImageViewerModal({ images, index, visible, onClose, onIndexChange }: ImageViewerModalProps) {
  const insets = useSafeAreaInsets();
  const count = images.length;

  // 부모가 index 를 바꾸거나 다시 열 때 현재 위치를 맞춘다 (렌더 중 상태 조정 패턴)
  const [current, setCurrent] = useState(index);
  const [synced, setSynced] = useState({ index, visible });
  if (synced.index !== index || synced.visible !== visible) {
    setSynced({ index, visible });
    if (index !== synced.index || (visible && !synced.visible)) setCurrent(index);
  }

  const safeIndex = count === 0 ? 0 : Math.min(Math.max(current, 0), count - 1);
  const image = images[safeIndex];
  const [zoomSignal, setZoomSignal] = useState(0);

  function go(next: number) {
    if (next < 0 || next >= count || next === safeIndex) return;
    setCurrent(next);
    onIndexChange?.(next);
  }

  const onKey = useEffectEvent((key: string) => {
    if (key === 'ArrowLeft') go(safeIndex - 1);
    else if (key === 'ArrowRight') go(safeIndex + 1);
  });

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = (event: KeyboardEvent) => onKey(event.key);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible]);

  return (
    <Modal
      visible={visible && count > 0}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      <GestureHandlerRootView style={styles.root}>
        <StatusBar style="light" />
        {image ? (
          <ZoomableImage
            key={`${safeIndex}-${image.uri}`}
            uri={image.uri}
            label={image.label ?? `${safeIndex + 1}번째 사진`}
            canPrev={safeIndex > 0}
            canNext={safeIndex < count - 1}
            onSwipe={(dir) => go(safeIndex + dir)}
            zoomSignal={zoomSignal}
          />
        ) : null}

        <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
          <View
            style={styles.counter}
            accessible
            accessibilityLabel={`전체 ${count}장 중 ${safeIndex + 1}번째 사진${image?.label ? `, ${image.label}` : ''}`}
          >
            <Text variant="label" color={colors.white}>
              {safeIndex + 1} / {count}
            </Text>
          </View>
          {image?.label ? (
            <Text variant="secondary" color={colors.textInverseMuted} numberOfLines={1} style={styles.label}>
              {image.label}
            </Text>
          ) : (
            <View style={styles.label} />
          )}
          <IconButton
            icon="scan-outline"
            variant="onDark"
            accessibilityLabel="확대/축소"
            onPress={() => setZoomSignal((n) => n + 1)}
          />
          <IconButton icon="close" variant="onDark" accessibilityLabel="닫기" onPress={onClose} iconSize={26} />
        </View>

        {count > 1 ? (
          <>
            <IconButton
              icon="chevron-back"
              variant="onDark"
              size={48}
              iconSize={28}
              accessibilityLabel="이전 사진"
              disabled={safeIndex === 0}
              onPress={() => go(safeIndex - 1)}
              style={[styles.arrow, styles.arrowLeft]}
            />
            <IconButton
              icon="chevron-forward"
              variant="onDark"
              size={48}
              iconSize={28}
              accessibilityLabel="다음 사진"
              disabled={safeIndex === count - 1}
              onPress={() => go(safeIndex + 1)}
              style={[styles.arrow, styles.arrowRight]}
            />
          </>
        ) : null}

        <View style={[styles.hint, { paddingBottom: insets.bottom + spacing.md }]} pointerEvents="none">
          <Text variant="caption" color={colors.textInverseMuted} align="center">
            {Platform.OS === 'web' ? '두 번 클릭하면 확대됩니다 · ← → 키로 넘길 수 있습니다' : '두 번 탭하거나 두 손가락으로 확대할 수 있습니다'}
          </Text>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

interface ZoomableImageProps {
  uri: string;
  label: string;
  canPrev: boolean;
  canNext: boolean;
  onSwipe: (direction: -1 | 1) => void;
  /** 값이 바뀔 때마다 확대/원래 크기 전환 */
  zoomSignal: number;
}

function ZoomableImage({ uri, label, canPrev, canNext, onSwipe, zoomSignal }: ZoomableImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const mountedSignal = useRef(zoomSignal);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const swipeX = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);

  useEffect(() => {
    if (zoomSignal === mountedSignal.current) return;
    mountedSignal.current = zoomSignal;
    const zoomed = scale.get() > 1.01;
    scale.set(withTiming(zoomed ? 1 : 2));
    tx.set(withTiming(0));
    ty.set(withTiming(0));
  }, [zoomSignal, scale, tx, ty]);

  const clampOffset = (value: number, size: number, s: number) => {
    'worklet';
    const max = Math.max(0, (size * (s - 1)) / 2);
    return Math.min(max, Math.max(-max, value));
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.set(scale.get());
    })
    .onUpdate((e) => {
      const next = Math.min(MAX_SCALE, Math.max(1, savedScale.get() * e.scale));
      scale.set(next);
      tx.set(clampOffset(tx.get(), width.get(), next));
      ty.set(clampOffset(ty.get(), height.get(), next));
    })
    .onEnd(() => {
      if (scale.get() < 1.05) {
        scale.set(withTiming(1));
        tx.set(withTiming(0));
        ty.set(withTiming(0));
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      savedTx.set(tx.get());
      savedTy.set(ty.get());
    })
    .onUpdate((e) => {
      if (scale.get() > 1.01) {
        tx.set(clampOffset(savedTx.get() + e.translationX, width.get(), scale.get()));
        ty.set(clampOffset(savedTy.get() + e.translationY, height.get(), scale.get()));
      } else {
        // 끝 사진에서는 살짝만 움직인다
        const resist = (e.translationX > 0 && !canPrev) || (e.translationX < 0 && !canNext) ? 0.25 : 1;
        swipeX.set(e.translationX * resist);
      }
    })
    .onEnd((e) => {
      if (scale.get() <= 1.01) {
        const threshold = Math.min(120, width.get() * 0.18);
        if ((e.translationX < -threshold || e.velocityX < -800) && canNext) scheduleOnRN(onSwipe, 1);
        else if ((e.translationX > threshold || e.velocityX > 800) && canPrev) scheduleOnRN(onSwipe, -1);
      }
      swipeX.set(withTiming(0, { duration: 180 }));
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd((e) => {
      if (scale.get() > 1.01) {
        scale.set(withTiming(1));
        tx.set(withTiming(0));
        ty.set(withTiming(0));
      } else {
        // 누른 지점이 가운데로 오도록 확대
        const s = DOUBLE_TAP_SCALE;
        scale.set(withTiming(s));
        tx.set(withTiming(clampOffset((width.get() / 2 - e.x) * (s - 1), width.get(), s)));
        ty.set(withTiming(clampOffset((height.get() / 2 - e.y) * (s - 1), height.get(), s)));
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() + swipeX.get() }, { translateY: ty.get() }, { scale: scale.get() }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.stage}
        onLayout={(e) => {
          width.set(e.nativeEvent.layout.width);
          height.set(e.nativeEvent.layout.height);
        }}
      >
        {status === 'loading' ? <ActivityIndicator size="large" color={colors.white} style={styles.spinner} /> : null}
        {status === 'error' ? (
          <View style={styles.error}>
            <Icon name="image-outline" size={40} color={colors.textInverseMuted} />
            <Text variant="body" color={colors.textInverseMuted}>
              사진을 불러오지 못했습니다.
            </Text>
          </View>
        ) : null}
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            transition={120}
            accessibilityLabel={label}
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // RN-web 의 Modal 내부 래퍼는 늘어나지 않으므로 flex 대신 전체 채우기
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.viewerBg,
  },
  stage: {
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    position: 'absolute',
  },
  error: {
    position: 'absolute',
    alignItems: 'center',
    gap: spacing.sm,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(5,16,31,0.55)',
  },
  counter: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  label: {
    flex: 1,
  },
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -24,
  },
  arrowLeft: {
    left: spacing.md,
  },
  arrowRight: {
    right: spacing.md,
  },
  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
  },
});
