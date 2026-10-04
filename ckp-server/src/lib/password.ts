/**
 * 비밀번호 검증 (sys_app_usr_mng.usr_pwd 두 형식 호환)
 *   - bcrypt($2a$/$2b$/$2y$): bcrypt.compare(원문 그대로)            ← Next.js 가입/변경
 *   - MD5 소문자 hex 32자: md5(trim(원문)) — UTF-8 우선, 실패 시 CP949 ← Java 관리자 초기화/구 앱
 *   - 그 외 형식: 항상 거부
 * 실패 응답 시간은 형식과 관계없이 bcrypt 1회 수준으로 맞춘다(없는 계정·MD5 계정 구분 방지, DESIGN §2.1).
 * bcrypt(순수 JS, 메인 스레드)는 동시에 BCRYPT_MAX_CONCURRENCY 개까지만 실행하고, 대기열이 가득 차면
 * PasswordBusyError 를 던진다(로그인 폭주가 EDI 업로드 등 다른 요청을 멈추지 않도록).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import iconv from 'iconv-lite';
import { ConcurrencyLimiter } from './attempts.js';

export type PasswordScheme = 'bcrypt' | 'md5' | 'unknown';

export interface PasswordCheck {
  ok: boolean;
  scheme: PasswordScheme;
  /** MD5 일치 시 사용된 문자 인코딩 */
  encoding?: 'utf8' | 'cp949';
}

const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const MD5_RE = /^[0-9a-fA-F]{32}$/;

/** 계정이 없을 때 응답 시간을 맞추기 위한 더미 해시 (처음 필요할 때 1회 생성) */
let dummyHash: Promise<string> | null = null;

/** bcrypt 동시 실행 수 / 대기열 길이 (프로세스 전체 공통) */
export const BCRYPT_MAX_CONCURRENCY = 2;
export const BCRYPT_MAX_QUEUE = 64;
const bcryptSlots = new ConcurrencyLimiter(BCRYPT_MAX_CONCURRENCY, BCRYPT_MAX_QUEUE);

/** bcrypt 대기열이 가득 차 지금은 검증할 수 없음 (라우트에서 429 로 변환) */
export class PasswordBusyError extends Error {
  constructor() {
    super('비밀번호 검증 대기열이 가득 찼습니다.');
    this.name = 'PasswordBusyError';
  }
}

async function withBcryptSlot<T>(fn: () => Promise<T>): Promise<T> {
  const release = bcryptSlots.tryAcquire();
  if (!release) throw new PasswordBusyError();
  await release.ready;
  try {
    return await fn();
  } finally {
    release.done();
  }
}

export function detectScheme(stored: string | null | undefined): PasswordScheme {
  if (!stored) return 'unknown';
  if (BCRYPT_RE.test(stored)) return 'bcrypt';
  if (MD5_RE.test(stored)) return 'md5';
  return 'unknown';
}

/** Java EgovMessageDigest 와 동일: md5(trim(password)) 소문자 hex */
export function md5Hex(password: string, encoding: 'utf8' | 'cp949' = 'utf8'): string {
  const bytes = encoding === 'utf8' ? Buffer.from(password.trim(), 'utf8') : iconv.encode(password.trim(), 'cp949');
  return createHash('md5').update(bytes).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase(), 'utf8');
  const bb = Buffer.from(b.toLowerCase(), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function hasNonAscii(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7f]/.test(s);
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<PasswordCheck> {
  const scheme = detectScheme(stored);
  if (scheme === 'bcrypt') {
    const ok = await withBcryptSlot(() => bcrypt.compare(password, stored as string));
    return { ok, scheme };
  }
  if (scheme === 'md5') {
    const target = stored as string;
    if (safeEqualHex(md5Hex(password, 'utf8'), target)) return { ok: true, scheme, encoding: 'utf8' };
    // ASCII 만 있으면 CP949 바이트도 동일하므로 재시도 불필요
    if (hasNonAscii(password) && safeEqualHex(md5Hex(password, 'cp949'), target)) {
      return { ok: true, scheme, encoding: 'cp949' };
    }
    // MD5 는 1ms 도 걸리지 않아 그대로 두면 '있는 MD5 계정'이 응답 시간으로 드러난다 → 없는 계정과 같게 맞춘다
    await dummyVerify();
    return { ok: false, scheme };
  }
  // 알 수 없는 형식(평문 가능성 포함)은 거부. 응답 시간은 bcrypt 와 비슷하게 맞춘다.
  await dummyVerify();
  return { ok: false, scheme: 'unknown' };
}

/** 존재하지 않는 계정일 때 호출해 응답 시간 차이를 줄인다. */
export async function dummyVerify(): Promise<void> {
  dummyHash ??= bcrypt.hash('ckp-dummy-password', 10);
  const hash = await dummyHash;
  await withBcryptSlot(() => bcrypt.compare('not-a-real-password', hash));
}

/** 새 비밀번호 저장용 bcrypt 해시 (cost 10) */
export async function hashPassword(password: string, cost = 10): Promise<string> {
  return withBcryptSlot(() => bcrypt.hash(password, cost));
}
