/** 샘플 모드 동작 설정 (계정 화면의 토글). 메모리에만 저장된다. */
import { useSyncExternalStore } from 'react';

export interface SampleSettings {
  /** 켜면 새 사진 3장 중 1장꼴로 업로드가 실패한다 (자동 재시도 2회까지 실패, 그다음 재시도는 성공) */
  simulateUploadFailure: boolean;
  /** 켜면 관리자가 EDI 등록을 차단한 상태를 흉내 낸다 (status.enabled=false, 업로드·제출 403) */
  simulateEdiDisabled: boolean;
}

let current: SampleSettings = { simulateUploadFailure: false, simulateEdiDisabled: false };
const listeners = new Set<() => void>();

export const sampleSettings = {
  get(): SampleSettings {
    return current;
  },
  set(patch: Partial<SampleSettings>): void {
    current = { ...current, ...patch };
    for (const listener of [...listeners]) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useSampleSettings(): SampleSettings {
  return useSyncExternalStore(sampleSettings.subscribe, sampleSettings.get, sampleSettings.get);
}
