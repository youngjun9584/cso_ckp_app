/**
 * 사진 개수 제한(최대 30장) 처리 — 순수 함수 (DESIGN §7.2 "초과 안내 시트").
 * 남은 수보다 많이 가져오면 절대 조용히 버리지 않고 사용자가 고르게 한다.
 */

export type AdditionPlan =
  /** 모두 추가 가능 */
  | { kind: 'fits'; incoming: number; remaining: number }
  /** 이미 가득 참 — 아무것도 추가할 수 없음 */
  | { kind: 'full'; incoming: number; max: number }
  /** 일부만 추가 가능 → 초과 안내 시트 */
  | { kind: 'overflow'; incoming: number; remaining: number; max: number };

export function remainingCapacity(counted: number, max: number): number {
  return Math.max(0, max - counted);
}

export function planAddition(incoming: number, counted: number, max: number): AdditionPlan {
  const remaining = remainingCapacity(counted, max);
  if (incoming <= remaining) return { kind: 'fits', incoming, remaining };
  if (remaining === 0) return { kind: 'full', incoming, max };
  return { kind: 'overflow', incoming, remaining, max };
}

/** [앞에서부터 N장 추가] */
export function takeFirst<T>(items: readonly T[], n: number): T[] {
  return items.slice(0, Math.max(0, n));
}

/** [직접 고르기] 에서 체크된 항목만 원래 순서대로 */
export function pickSelected<T>(items: readonly T[], selected: ReadonlySet<number>): T[] {
  return items.filter((_, i) => selected.has(i));
}

export interface ManualSelectionState {
  selected: number;
  remaining: number;
  /** 더 해제해야 하는 수 (0 이면 추가 가능) */
  excess: number;
  canAdd: boolean;
}

export function manualSelectionState(selected: number, remaining: number): ManualSelectionState {
  const excess = Math.max(0, selected - remaining);
  return { selected, remaining, excess, canAdd: selected > 0 && excess === 0 };
}

/** '선택한 사진 35장 중 18장만 더 추가할 수 있습니다(최대 30장).' */
export function overflowMessage(incoming: number, remaining: number, max: number): string {
  return `선택한 사진 ${incoming}장 중 ${remaining}장만 더 추가할 수 있습니다(최대 ${max}장).`;
}

export function fullMessage(max: number): string {
  return `사진은 최대 ${max}장까지 등록할 수 있습니다. 사진을 지운 뒤 다시 추가해 주세요.`;
}
