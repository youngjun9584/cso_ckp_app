/**
 * 로그인 상태 관리.
 * - 시작 시 restoreSession()(native: SecureStore refresh 토큰 / web: httpOnly 쿠키)으로 복원
 * - API 계층에서 refresh 까지 실패하면 sessionEvents 로 알림 → 로그아웃 처리 + 안내
 */
import { createContext, use, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { toast } from '@/components/ui/Toast';
import { getApi } from '@/lib/api';
import type { AuthUser } from '@/lib/api/contract';
import { MSG, getErrorMessage } from '@/lib/api/errors';
import { sessionEvents } from './session-events';

export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** 실패하면 ApiError 를 던진다 (INVALID_CREDENTIALS, ACCOUNT_NOT_APPROVED, RATE_LIMITED, 네트워크 등) */
  signIn(usrId: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  /** 자동 로그인 복원이 네트워크 문제로 실패했을 때의 안내 문구 (로그인 화면에 표시) */
  restoreError: string | null;
  /** 자동 로그인 복원을 다시 시도 */
  retryRestore(): Promise<void>;
  /** GET /v1/auth/me 로 사용자 정보를 새로 고침 */
  reloadUser(): Promise<void>;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  restoreError: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'restoring', user: null, restoreError: null });
  // 이벤트 콜백에서 최신 상태를 알기 위해 setState 와 함께 갱신한다
  const statusRef = useRef<AuthStatus>('restoring');

  function update(next: AuthState) {
    statusRef.current = next.status;
    setState(next);
  }

  function applyRestore(result: { user: AuthUser | null } | { error: unknown }) {
    if ('error' in result) {
      update({
        status: 'signedOut',
        user: null,
        restoreError: `자동 로그인을 하지 못했습니다. ${getErrorMessage(result.error, MSG.network)}`,
      });
    } else if (result.user) {
      update({ status: 'signedIn', user: result.user, restoreError: null });
    } else {
      update({ status: 'signedOut', user: null, restoreError: null });
    }
  }

  const onRestoreSettled = useEffectEvent(applyRestore);

  // 앱 시작 시 한 번만 복원한다
  useEffect(() => {
    let active = true;
    getApi()
      .restoreSession()
      .then(
        (user) => {
          if (active) onRestoreSettled({ user });
        },
        (error: unknown) => {
          if (active) onRestoreSettled({ error });
        },
      );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return sessionEvents.onExpired(() => {
      if (statusRef.current !== 'signedIn') return;
      sessionEvents.emitSignedOut('expired');
      update({ status: 'signedOut', user: null, restoreError: null });
      setTimeout(() => queryClient.clear(), 0);
      toast.info(MSG.sessionExpired);
    });
  }, [queryClient]);

  async function signIn(usrId: string, password: string): Promise<AuthUser> {
    const res = await getApi().login({ usrId, password });
    queryClient.clear();
    update({ status: 'signedIn', user: res.user, restoreError: null });
    return res.user;
  }

  async function signOut(): Promise<void> {
    statusRef.current = 'signedOut';
    // 토큰을 지우기 전에 화면 밖 작업(EDI 업로드·제출)을 먼저 멈춘다 — 다음 로그인 사용자의 세션으로 이어지지 않게
    sessionEvents.emitSignedOut('logout');
    await getApi().logout();
    update({ status: 'signedOut', user: null, restoreError: null });
    // 화면이 내려간 뒤 캐시를 비운다 (마운트된 쿼리가 다시 요청하지 않도록)
    setTimeout(() => queryClient.clear(), 0);
  }

  /** 상태는 signedOut 으로 둔 채 복원만 다시 시도한다 (내비게이터를 다시 만들지 않도록) */
  async function retryRestore(): Promise<void> {
    try {
      applyRestore({ user: await getApi().restoreSession() });
    } catch (error) {
      applyRestore({ error });
    }
  }

  async function reloadUser(): Promise<void> {
    const res = await getApi().me();
    if (statusRef.current === 'signedIn') update({ status: 'signedIn', user: res.user, restoreError: null });
  }

  const value: AuthContextValue = {
    status: state.status,
    user: state.user,
    restoreError: state.restoreError,
    signIn,
    signOut,
    retryRestore,
    reloadUser,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth 는 AuthProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
