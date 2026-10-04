/**
 * 주입 가능한 시계. 서버의 모든 "현재 시각"은 이 인터페이스를 통해 얻는다(테스트에서 고정·이동 가능).
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** 테스트용 시계: set/advance 로 시각을 바꿀 수 있다. */
export interface TestClock extends Clock {
  set(at: Date | string | number): void;
  advance(ms: number): void;
}

export function createTestClock(initial: Date | string | number = Date.now()): TestClock {
  let current = new Date(initial).getTime();
  return {
    now: () => new Date(current),
    set(at) {
      current = new Date(at).getTime();
    },
    advance(ms) {
      current += ms;
    },
  };
}
