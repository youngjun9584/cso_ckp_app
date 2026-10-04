/**
 * 화면 이탈 가드 (DESIGN §6.1 탭 이동 가드).
 * - 작성 중인 화면이 registerLeaveGuard / useLeaveGuard 로 "나가면 안 되는 이유"를 등록한다.
 * - 탭 바·사이드바·헤더의 계정 버튼은 이동 전에 confirmLeave() 를 호출한다.
 * - 웹 새로고침/창 닫기는 useBeforeUnloadWeb(message) 로 막는다.
 * - 같은 스택 안의 뒤로가기는 화면에서 usePreventRemove('expo-router/react-navigation')로 직접 처리한다.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { router, type Href } from 'expo-router';

import { confirm } from '@/components/ui/ConfirmDialog';

/** 나가도 되면 null, 확인이 필요하면 사용자에게 보여줄 한국어 문장 */
export type LeaveGuard = () => string | null;

const guards = new Map<string, LeaveGuard>();

export function registerLeaveGuard(id: string, guard: LeaveGuard): () => void {
  guards.set(id, guard);
  return () => {
    if (guards.get(id) === guard) guards.delete(id);
  };
}

/** 등록된 가드 중 첫 번째 확인 문구 (없으면 null). ignore 에 든 id 의 가드는 건너뛴다 */
export function getLeaveMessage(ignore?: readonly string[]): string | null {
  for (const [id, guard] of guards) {
    if (ignore?.includes(id)) continue;
    try {
      const message = guard();
      if (message) return message;
    } catch {
      // 가드 오류로 이동이 막히지 않게 한다
    }
  }
  return null;
}

export interface ConfirmLeaveOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  /**
   * 확인하지 않을 가드 id. 이동하는 곳이 바로 그 가드의 화면일 때 쓴다
   * (예: 홈의 '새 EDI 등록' → 작성 중인 EDI 화면으로 돌아가는 것이므로 'edi-new-draft' 는 묻지 않는다).
   */
  ignore?: readonly string[];
}

/** 확인 대화상자가 떠 있는 동안 들어온 이동 요청(연타·다른 버튼)은 새 대화상자를 쌓지 않고 취소한다 */
let pendingConfirm: Promise<boolean> | null = null;

/** 이동해도 되면 true. 가드가 있으면 확인 대화상자를 띄운다. */
export async function confirmLeave(options: ConfirmLeaveOptions = {}): Promise<boolean> {
  const message = getLeaveMessage(options.ignore);
  if (!message) return true;
  if (pendingConfirm) return false;
  const request = confirm({
    title: options.title ?? '이 화면을 나갈까요?',
    message,
    confirmText: options.confirmText ?? '나가기',
    cancelText: options.cancelText ?? '계속 작성',
    tone: 'danger',
  });
  pendingConfirm = request;
  try {
    return await request;
  } finally {
    if (pendingConfirm === request) pendingConfirm = null;
  }
}

/** confirmLeave() 후 이동 */
export async function navigateGuarded(
  href: Href,
  mode: 'navigate' | 'push' | 'replace' = 'navigate',
  options?: ConfirmLeaveOptions,
): Promise<boolean> {
  if (!(await confirmLeave(options))) return false;
  if (mode === 'push') router.push(href);
  else if (mode === 'replace') router.replace(href);
  else router.navigate(href);
  return true;
}

/**
 * 컴포넌트가 마운트된 동안 가드를 등록한다. guard 는 이동 시점에 호출되므로 최신 상태를 읽는다.
 *   useLeaveGuard('edi-draft', () => (hasDraft ? '작성 중인 EDI 등록 내용이 있습니다. …' : null));
 */
export function useLeaveGuard(id: string, guard: LeaveGuard): void {
  const latest = useRef(guard);
  useEffect(() => {
    latest.current = guard;
  });
  useEffect(() => registerLeaveGuard(id, () => latest.current()), [id]);
}

/** 웹에서 message 가 있으면 새로고침·탭 닫기 전에 브라우저 확인창을 띄운다 (null 이면 해제) */
export function useBeforeUnloadWeb(message: string | null): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !message || typeof window === 'undefined') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 일부 브라우저는 returnValue 를 설정해야 확인창을 띄운다 (문구는 브라우저 기본 문구로 표시됨)
      event.returnValue = message;
      return message;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [message]);
}
