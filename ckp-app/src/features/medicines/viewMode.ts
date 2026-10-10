/**
 * 의약품 목록 보기 방식(카드 / 표) — 사용자가 고르면 기기에 저장해 다음에도 유지한다.
 * 고르지 않았으면(null) 화면 너비에 따라 자동(넓은 화면 = 표, 좁은 화면 = 카드).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type MedicineViewMode = 'card' | 'table';

const STORAGE_KEY = 'ckp.medicines.viewMode';

interface ViewModeState {
  /** 사용자가 고른 값. null 이면 자동 */
  mode: MedicineViewMode | null;
  setMode: (mode: MedicineViewMode) => void;
}

function isMode(v: unknown): v is MedicineViewMode {
  return v === 'card' || v === 'table';
}

export const useMedicineViewMode = create<ViewModeState>((set) => {
  // 저장된 선택을 비동기로 불러온다 (실패해도 자동 모드로 동작)
  AsyncStorage.getItem(STORAGE_KEY)
    .then((v) => {
      if (isMode(v)) set({ mode: v });
    })
    .catch(() => undefined);

  return {
    mode: null,
    setMode: (mode) => {
      set({ mode });
      AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => undefined);
    },
  };
});

export const VIEW_MODE_OPTIONS: readonly { value: MedicineViewMode; label: string }[] = [
  { value: 'card', label: '카드' },
  { value: 'table', label: '표' },
];
