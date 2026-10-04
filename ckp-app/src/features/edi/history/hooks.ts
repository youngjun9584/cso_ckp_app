import { useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { useMeta } from '@/lib/auth';
import { kstYm } from '@/lib/kst';

/** 1분마다·앱이 다시 활성화될 때 확인 — 값('YYYY-MM')이 바뀔 때만 다시 그린다 */
function subscribeClock(onChange: () => void): () => void {
  const timer = setInterval(onChange, 60_000);
  const sub = AppState.addEventListener('change', onChange);
  return () => {
    clearInterval(timer);
    sub.remove();
  };
}

const readKstYm = () => kstYm();

/**
 * 오늘(KST)의 연월. 기기 시계가 서버보다 늦으면 서버 시각(meta.serverTime)을 따른다.
 * 등록월 이동의 상한(현재 달 이후로는 이동하지 않음)에 쓴다.
 */
export function useCurrentKstMonth(): string {
  const deviceYm = useSyncExternalStore(subscribeClock, readKstYm, readKstYm);
  const serverYm = useMeta().data?.serverTime?.slice(0, 7) ?? '';
  return /^\d{4}-\d{2}$/.test(serverYm) && serverYm > deviceYm ? serverYm : deviceYm;
}

/**
 * 서명된 사진 URL(만료 1시간)을 불러오지 못했을 때 데이터를 한 번만 다시 받아 새 URL 을 얻는다.
 * 짧은 시간 안에 여러 사진이 실패해도 한 번만 요청하고, 계속 실패하는 사진 때문에 반복 요청하지 않는다.
 */
export function useExpiredImageRefetch(refetch: () => unknown, minIntervalMs = 10 * 60_000): () => void {
  const lastRef = useRef<number | null>(null);
  return () => {
    const now = Date.now();
    if (lastRef.current !== null && now - lastRef.current < minIntervalMs) return;
    lastRef.current = now;
    void refetch();
  };
}
