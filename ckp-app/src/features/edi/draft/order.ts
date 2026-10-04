/**
 * 사진 순서 도우미 (순수 함수). 배열 순서 = 화면 순번이며, 모든 함수는 새 배열을 돌려준다.
 * 순번은 "처리할 수 없는(invalid)" 사진을 건너뛰고 1..N 으로 매긴다 — 화면에 보이는 번호가 곧 제출 seq 다.
 */

export interface Keyed {
  localId: string;
}

/** 순번 대상인지 (기본: 모든 항목) */
export type CountedPredicate<T> = (item: T) => boolean;

export type MoveDirection = 'first' | 'earlier' | 'later' | 'last';

/** localId → 순번(1..N). 순번 대상이 아니면 map 에 없다. */
export function seqMap<T extends Keyed>(list: readonly T[], isCounted: CountedPredicate<T> = () => true): Map<string, number> {
  const map = new Map<string, number>();
  let seq = 0;
  for (const item of list) {
    if (!isCounted(item)) continue;
    seq += 1;
    map.set(item.localId, seq);
  }
  return map;
}

export function removeById<T extends Keyed>(list: readonly T[], id: string): T[] {
  return list.filter((item) => item.localId !== id);
}

export function removeByIds<T extends Keyed>(list: readonly T[], ids: ReadonlySet<string>): T[] {
  return list.filter((item) => !ids.has(item.localId));
}

/** 배열 위치 from → to 로 한 항목을 옮긴다 (범위를 벗어나면 가장자리로) */
export function moveIndex<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * 순번 기준으로 한 칸/맨 앞/맨 뒤 이동. 순번 대상이 아닌 항목(invalid)은 건너뛰고
 * "앞 번호의 사진 바로 앞" / "뒤 번호의 사진 바로 뒤" 로 옮겨 번호가 반드시 바뀌게 한다.
 * 움직일 수 없으면(이미 맨 앞 등) 같은 순서의 새 배열.
 */
export function movePhoto<T extends Keyed>(
  list: readonly T[],
  id: string,
  direction: MoveDirection,
  isCounted: CountedPredicate<T> = () => true,
): T[] {
  const from = list.findIndex((item) => item.localId === id);
  if (from < 0 || !isCounted(list[from])) return [...list];

  const countedIdx: number[] = [];
  list.forEach((item, i) => {
    if (isCounted(item)) countedIdx.push(i);
  });
  const pos = countedIdx.indexOf(from);

  let targetPos: number;
  if (direction === 'first') targetPos = 0;
  else if (direction === 'last') targetPos = countedIdx.length - 1;
  else if (direction === 'earlier') targetPos = pos - 1;
  else targetPos = pos + 1;

  if (targetPos < 0 || targetPos >= countedIdx.length || targetPos === pos) return [...list];

  const next = [...list];
  const [item] = next.splice(from, 1);
  const anchorId = list[countedIdx[targetPos]].localId;
  const anchorIndex = next.findIndex((x) => x.localId === anchorId);
  // 앞으로 옮기면 기준 사진의 앞, 뒤로 옮기면 기준 사진의 뒤
  next.splice(targetPos < pos ? anchorIndex : anchorIndex + 1, 0, item);
  return next;
}

export function canMove<T extends Keyed>(
  list: readonly T[],
  id: string,
  direction: MoveDirection,
  isCounted: CountedPredicate<T> = () => true,
): boolean {
  const seqs = seqMap(list, isCounted);
  const seq = seqs.get(id);
  if (seq === undefined) return false;
  if (direction === 'first' || direction === 'earlier') return seq > 1;
  return seq < seqs.size;
}

/**
 * 드래그 결과(키 순서)를 현재 목록에 적용한다.
 * - 드래그 중 사라진 키는 무시, 목록에는 있는데 keys 에 없는 항목은 원래 순서대로 뒤에 붙인다(절대 버리지 않음).
 * - 중복 키는 처음 것만 쓴다.
 */
export function reorderByKeys<T extends Keyed>(list: readonly T[], keys: readonly string[]): T[] {
  const byId = new Map(list.map((item) => [item.localId, item] as const));
  const used = new Set<string>();
  const next: T[] = [];
  for (const key of keys) {
    const item = byId.get(key);
    if (!item || used.has(key)) continue;
    used.add(key);
    next.push(item);
  }
  for (const item of list) {
    if (!used.has(item.localId)) next.push(item);
  }
  return next;
}

/** 두 목록이 같은 순서인지 */
export function sameOrder<T extends Keyed>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => item.localId === b[i].localId);
}
