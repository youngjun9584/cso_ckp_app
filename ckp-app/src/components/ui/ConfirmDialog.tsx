/**
 * 확인 대화상자 (웹·네이티브 공통 모달).
 *   const ok = await confirm({ title: '로그아웃할까요?', confirmText: '로그아웃', tone: 'danger' });
 * confirm() 은 컴포넌트 밖(내비게이션 가드 등)에서도 쓸 수 있다. ConfirmProvider 가 없으면 시스템 대화상자로 대신한다.
 *
 * iOS 는 다른 Modal 이 열려 있거나 닫히는 중일 때 새 Modal 을 띄우지 못하고 조용히 무시한다.
 * 그래서 iOS 에서는 대화상자가 실제로 보였는지(onShow) 확인하고, 일정 시간 안에 보이지 않으면
 * 한 번 다시 띄워 보고, 그래도 안 되면 시스템 대화상자(Alert — 별도 창에 뜨므로 항상 보인다)로 대신 묻는다.
 * 어떤 경우에도 confirm() 이 영원히 끝나지 않는 일은 없다.
 */
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, shadow, spacing, useIsWide } from '@/theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** 기본 '확인' */
  confirmText?: string;
  /** 기본 '취소'. null 이면 버튼 하나(알림)만 보인다 */
  cancelText?: string | null;
  /** danger: 확인 버튼을 빨간색으로 (삭제·나가기 등) */
  tone?: 'default' | 'danger';
  /** 바깥 영역을 누르거나 뒤로가기/Esc 로 닫으면 취소(false). 기본 true */
  dismissible?: boolean;
}

interface PendingRequest {
  id: number;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

let showImpl: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

/** iOS 에서 대화상자가 이 시간 안에 보이지 않으면(onShow 없음) 다시 띄우거나 시스템 대화상자로 대신한다 */
const SHOW_TIMEOUT_MS = 1200;

function systemConfirm(options: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return Promise.resolve(false);
    const text = [options.title, options.message].filter(Boolean).join('\n\n');
    if (options.cancelText === null) {
      window.alert(text);
      return Promise.resolve(true);
    }
    return Promise.resolve(window.confirm(text));
  }
  return new Promise((resolve) => {
    Alert.alert(
      options.title,
      options.message,
      [
        ...(options.cancelText === null
          ? []
          : [{ text: options.cancelText ?? '취소', style: 'cancel' as const, onPress: () => resolve(false) }]),
        {
          text: options.confirmText ?? '확인',
          style: options.tone === 'danger' ? ('destructive' as const) : ('default' as const),
          onPress: () => resolve(true),
        },
      ],
      { cancelable: options.dismissible ?? true, onDismiss: () => resolve(false) },
    );
  });
}

/** 확인 대화상자를 띄우고 사용자의 선택(true=확인, false=취소)을 돌려준다 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return showImpl ? showImpl(options) : systemConfirm(options);
}

/** 버튼 하나짜리 알림 */
export async function alertDialog(options: Omit<ConfirmOptions, 'cancelText'>): Promise<void> {
  await confirm({ ...options, cancelText: null });
}

export function useConfirm(): typeof confirm {
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PendingRequest[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    showImpl = (options) =>
      new Promise<boolean>((resolve) => {
        nextId.current += 1;
        const id = nextId.current;
        setQueue((q) => [...q, { id, options, resolve }]);
      });
    return () => {
      showImpl = null;
    };
  }, []);

  const current = queue[0];

  function answer(value: boolean) {
    if (!current) return;
    current.resolve(value);
    setQueue((q) => q.filter((r) => r.id !== current.id));
  }

  /** 앱 대화상자를 띄울 수 없을 때: 큐에서 빼고 시스템 대화상자로 같은 질문을 한다 */
  function answerWithSystemDialog() {
    if (!current) return;
    const request = current;
    setQueue((q) => q.filter((r) => r.id !== request.id));
    systemConfirm(request.options).then(request.resolve, () => request.resolve(false));
  }

  return (
    <>
      {children}
      <ConfirmModal request={current ?? null} onAnswer={answer} onUnpresentable={answerWithSystemDialog} />
    </>
  );
}

interface ConfirmModalProps {
  request: PendingRequest | null;
  onAnswer: (value: boolean) => void;
  /** 다시 띄워도 보이지 않을 때 (iOS) */
  onUnpresentable: () => void;
}

function ConfirmModal({ request, onAnswer, onUnpresentable }: ConfirmModalProps) {
  const wide = useIsWide();
  const options = request?.options;
  const dismissible = options?.dismissible ?? true;
  const danger = options?.tone === 'danger';
  const hasCancel = options?.cancelText !== null;

  // ── 표시 확인 (iOS) ──
  // presented: 지금 Modal 이 화면에 떠 있는지 (연속된 요청은 Modal 이 계속 떠 있으므로 onShow 가 다시 오지 않는다)
  const presented = useRef(false);
  // 이미 한 번 다시 띄워 본 요청 id
  const retriedId = useRef<number | null>(null);
  // 값이 바뀌면 Modal 을 새로 만들어 다시 띄운다 (iOS 는 실패한 표시를 스스로 재시도하지 않는다)
  const [hostKey, setHostKey] = useState(0);
  const requestId = request?.id ?? null;

  const onShowTimeout = useEffectEvent((id: number) => {
    if (presented.current || requestId !== id) return;
    if (retriedId.current !== id) {
      retriedId.current = id;
      setHostKey((k) => k + 1);
    } else {
      onUnpresentable();
    }
  });

  useEffect(() => {
    if (requestId === null) {
      presented.current = false;
      return;
    }
    // Android Dialog·웹 모달은 겹쳐 띄울 수 있어 이 문제가 없다
    if (Platform.OS !== 'ios' || presented.current) return;
    const timer = setTimeout(() => onShowTimeout(requestId), SHOW_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [requestId, hostKey]);

  return (
    <Modal
      key={hostKey}
      visible={!!request}
      transparent
      animationType="fade"
      statusBarTranslucent
      onShow={() => {
        presented.current = true;
      }}
      onRequestClose={() => {
        if (dismissible) onAnswer(false);
      }}
    >
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (dismissible) onAnswer(false);
          }}
          accessibilityRole="button"
          accessibilityLabel="대화상자 닫기"
          importantForAccessibility="no"
          tabIndex={-1}
        />
        {options ? (
          <View style={[styles.dialog, wide && styles.dialogWide]} role="alertdialog" aria-modal accessibilityViewIsModal>
            <View style={styles.header}>
              {danger ? (
                <View style={styles.dangerIcon}>
                  <Icon name="warning-outline" size={22} color={colors.danger} />
                </View>
              ) : null}
              <Text variant="heading" role="heading" style={styles.title}>
                {options.title}
              </Text>
            </View>
            {options.message ? (
              <Text variant="body" tone="secondary">
                {options.message}
              </Text>
            ) : null}
            <View style={[styles.buttons, wide && styles.buttonsWide]}>
              {hasCancel ? (
                <Button
                  title={options.cancelText ?? '취소'}
                  variant="secondary"
                  onPress={() => onAnswer(false)}
                  style={wide ? undefined : styles.buttonFlex}
                />
              ) : null}
              <Button
                title={options.confirmText ?? '확인'}
                variant={danger ? 'danger' : 'primary'}
                onPress={() => onAnswer(true)}
                style={wide ? undefined : styles.buttonFlex}
              />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
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
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.card,
    borderRadius: radius.card + 2,
    padding: spacing.xxl,
    gap: spacing.md,
    ...shadow.overlay,
  },
  dialogWide: {
    maxWidth: 440,
  },
  header: {
    gap: spacing.md,
  },
  dangerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flexShrink: 1,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  buttonsWide: {
    justifyContent: 'flex-end',
  },
  buttonFlex: {
    flex: 1,
  },
});
