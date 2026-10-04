/** 화면 표시·입력 정리용 공통 도우미 */

export const onlyDigits = (value: string | null | undefined): string => (value ?? '').replace(/\D/g, '');

/** 사업자등록번호 입력 중 자동 하이픈: '1234567890' → '123-45-67890' */
export function formatBizNo(value: string | null | undefined): string {
  const d = onlyDigits(value).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/** 국세청 사업자등록번호 검증번호 확인 (숫자 10자리) */
export function isValidBizNo(value: string | null | undefined): boolean {
  const d = onlyDigits(value);
  if (d.length !== 10) return false;
  const nums = d.split('').map(Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += nums[i] * weights[i];
  sum += Math.floor((nums[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === nums[9];
}

/** 전화번호 자동 하이픈 (휴대전화·서울 02·지역번호·대표번호 15xx) */
export function formatPhone(value: string | null | undefined): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (/^1[5-9]\d{2}/.test(d) && d.length <= 8) {
    if (d.length <= 4) return d;
    return `${d.slice(0, 4)}-${d.slice(4)}`;
  }
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

const numberFormatter = new Intl.NumberFormat('ko-KR');

/** 12345 → '12,345' */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return numberFormatter.format(value);
}

/** 약가 표시: 숫자면 '1,234원', 아니면 원문('미정' 등) */
export function formatPrice(price: number | null | undefined, priceText?: string | null): string {
  if (price !== null && price !== undefined && !Number.isNaN(price)) return `${formatNumber(price)}원`;
  return priceText?.trim() ?? '';
}

/** 바이트 → '1.2MB' */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes < 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 빈 문자열·공백만 있는 값을 null 로 */
export function emptyToNull(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** 표시할 값이 있는지 (null/undefined/빈 문자열 제외) */
export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}
