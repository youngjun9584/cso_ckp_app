/**
 * 짧은 안내 메시지 (화면 위쪽, 몇 초 뒤 사라짐).
 *   toast.success('등록되었습니다.');   const t = useToast(); t.error('저장하지 못했습니다.');
 * toast 는 컴포넌트 밖에서도 쓸 수 있다 (ToastProvider 가 등록한다).
 */
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadow, spacing } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  /** 밀리초 (기본 3000, error 는 5000) */
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
}

export interface ToastApi {
  show(message: string, options?: ToastOptions): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

let showImpl: ((message: string, options?: ToastOptions) => void) | null = null;

export const toast: ToastApi = {
  show(message, options) {
    if (showImpl) showImpl(message, options);
    else console.info(`[toast] ${message}`);
  },
  info: (message) => toast.show(message, { tone: 'info' }),
  success: (message) => toast.show(message, { tone: 'success' }),
  warning: (message) => toast.show(message, { tone: 'warning' }),
  error: (message) => toast.show(message, { tone: 'error' }),
};

export function useToast(): ToastApi {
  return toast;
}

const TONES: Record<ToastTone, { icon: IconName; color: string }> = {
  info: { icon: 'information-circle', color: '#7CC4F2' },
  success: { icon: 'checkmark-circle', color: '#5FD3A5' },
  warning: { icon: 'warning', color: colors.accent },
  error: { icon: 'alert-circle', color: '#FF8A8F' },
};

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    showImpl = (message, options) => {
      const tone = options?.tone ?? 'info';
      nextId.current += 1;
      const item: ToastItem = {
        id: nextId.current,
        message,
        tone,
        duration: options?.duration ?? (tone === 'error' ? 5000 : 3000),
      };
      setItems((list) => [...list.filter((t) => t.message !== message), item].slice(-MAX_VISIBLE));
    };
    return () => {
      showImpl = null;
    };
  }, []);

  function dismiss(id: number) {
    setItems((list) => list.filter((t) => t.id !== id));
  }

  return (
    <View style={styles.root}>
      {children}
      <View pointerEvents="box-none" style={[styles.host, { top: insets.top + spacing.sm }]}>
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </View>
    </View>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const tone = TONES[item.tone];
  const onTimeout = useEffectEvent(() => onDismiss());

  useEffect(() => {
    const timer = setTimeout(() => onTimeout(), item.duration);
    return () => clearTimeout(timer);
  }, [item.duration]);

  return (
    <Animated.View entering={FadeInUp.duration(180)} exiting={FadeOutUp.duration(160)} style={styles.toastWrap}>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="alert"
        accessibilityLiveRegion={item.tone === 'error' ? 'assertive' : 'polite'}
        accessibilityLabel={item.message}
        accessibilityHint="누르면 닫힙니다"
        style={styles.toast}
      >
        <Icon name={tone.icon} size={20} color={tone.color} />
        <Text variant="secondary" color={colors.white} style={styles.message}>
          {item.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  host: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    zIndex: 1000,
    elevation: 1000,
  },
  toastWrap: {
    width: '100%',
    maxWidth: 480,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    // 네이비 배경(로그인 화면) 위에서도 구분되도록
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.control + 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 48,
    ...shadow.overlay,
  },
  message: {
    flex: 1,
  },
});
