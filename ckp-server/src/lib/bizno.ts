/**
 * 사업자등록번호: 정규화(숫자만) · 국세청 검증번호 · 표시 형식('123-45-67890')
 */

const WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const;

/** 숫자만 남긴다. '123-45-67890' → '1234567890' */
export function normalizeBizNo(input: string | null | undefined): string {
  return (input ?? '').replace(/\D/g, '');
}

/** 10자리 숫자에 대해 국세청 검증번호(마지막 자리) 확인 */
export function isValidBizNoChecksum(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  const d = digits.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (d[i] as number) * WEIGHTS[i]!;
  sum += Math.floor(((d[8] as number) * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return check === d[9];
}

/** 앞 9자리로 검증번호를 계산해 올바른 10자리 번호를 만든다 (테스트·샘플 데이터용) */
export function withBizNoCheckDigit(first9: string): string {
  if (!/^\d{9}$/.test(first9)) throw new RangeError('앞 9자리 숫자가 필요합니다.');
  const d = first9.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (d[i] as number) * WEIGHTS[i]!;
  sum += Math.floor(((d[8] as number) * 5) / 10);
  return `${first9}${(10 - (sum % 10)) % 10}`;
}

/** 표시용: 숫자가 정확히 10자리면 'XXX-XX-XXXXX', 아니면 원문(trim). 빈 값은 null */
export function formatBizNo(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const digits = normalizeBizNo(trimmed);
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  return trimmed;
}

export type BizNoCheck =
  | { ok: true; digits: string; formatted: string }
  | { ok: false; reason: 'empty' | 'length' | 'checksum' | 'chars'; message: string };

export const BIZNO_MESSAGES = {
  length: '사업자등록번호 10자리를 정확히 입력해 주세요.',
  checksum: '사업자등록번호가 유효하지 않습니다. 번호를 다시 확인해 주세요.',
  chars: '사업자등록번호는 숫자와 하이픈(-)만 입력할 수 있습니다.',
  empty: '사업자등록번호를 입력해 주세요.',
} as const;

/** 입력값 검증: 숫자·하이픈·공백만 허용, 숫자 10자리, 검증번호 일치 */
export function checkBizNo(input: string | null | undefined): BizNoCheck {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty', message: BIZNO_MESSAGES.empty };
  if (!/^[\d\-\s]+$/.test(trimmed)) return { ok: false, reason: 'chars', message: BIZNO_MESSAGES.chars };
  const digits = normalizeBizNo(trimmed);
  if (digits.length !== 10) return { ok: false, reason: 'length', message: BIZNO_MESSAGES.length };
  if (!isValidBizNoChecksum(digits)) return { ok: false, reason: 'checksum', message: BIZNO_MESSAGES.checksum };
  return { ok: true, digits, formatted: formatBizNo(digits) as string };
}
