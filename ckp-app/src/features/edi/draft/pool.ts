/** 동시 실행 수 제한 도우미 (순수, React Native 의존 없음) */

/**
 * items 를 최대 concurrency 개씩 동시에 worker 로 처리한다. 앞에서부터 순서대로 시작한다.
 * worker 의 실패는 삼키지 않는다 — worker 안에서 처리하고 resolve 하는 것을 전제로 하며,
 * 예외가 나면 나머지 작업은 계속 진행한 뒤 첫 번째 예외로 reject 한다.
 * signal 이 취소되면 아직 시작하지 않은 항목은 건너뛴다.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  let firstError: unknown = null;
  let failed = false;
  const lanes = Math.max(1, Math.min(concurrency, items.length));

  async function lane(): Promise<void> {
    for (;;) {
      if (signal?.aborted) return;
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: lanes }, () => lane()));
  if (failed) throw firstError;
}

interface QueuedTask {
  id: string;
  run: () => Promise<void>;
}

/**
 * 동적으로 작업을 넣는 큐 (사진 처리용, 동시 N개).
 * cancel(id) 은 아직 시작하지 않은 작업을 뺀다(이미 실행 중인 작업은 끝까지 실행된다 — 결과 반영은 호출자가 확인).
 */
export class TaskQueue {
  private readonly concurrency: number;
  private readonly pending: QueuedTask[] = [];
  private readonly running = new Set<string>();
  private idleWaiters: (() => void)[] = [];

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, concurrency);
  }

  get size(): number {
    return this.pending.length + this.running.size;
  }

  isQueued(id: string): boolean {
    return this.running.has(id) || this.pending.some((t) => t.id === id);
  }

  add(id: string, run: () => Promise<void>): void {
    this.pending.push({ id, run });
    this.pump();
  }

  cancel(id: string): boolean {
    const index = this.pending.findIndex((t) => t.id === id);
    if (index < 0) return false;
    this.pending.splice(index, 1);
    this.notifyIdle();
    return true;
  }

  cancelAll(): void {
    this.pending.length = 0;
    this.notifyIdle();
  }

  /** 대기·실행 중인 작업이 모두 끝나면 resolve */
  whenIdle(): Promise<void> {
    if (this.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      if (!task) break;
      this.running.add(task.id);
      void task
        .run()
        .catch(() => undefined)
        .finally(() => {
          this.running.delete(task.id);
          this.pump();
          this.notifyIdle();
        });
    }
  }

  private notifyIdle(): void {
    if (this.size > 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
