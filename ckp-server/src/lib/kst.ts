/**
 * 한국 표준시(KST, UTC+9, 서머타임 없음) 계산. 서버/DB 의 TZ 설정과 무관하게 동작하는 순수 함수들.
 * 모든 함수는 기준 시각(Date)을 인자로 받는다 → 라우트에서는 deps.clock.now() 를 넘긴다.
 */
import type { EdiMonthLabel, EdiMonthOption, EdiMonthOptionsResponse } from '../contract.js';

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface KstParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const pad4 = (n: number) => String(n).padStart(4, '0');

export function kstParts(at: Date): KstParts {
  const t = new Date(at.getTime() + KST_OFFSET_MS);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    second: t.getUTCSeconds(),
  };
}

/** 'YYYY-MM-DD' (KST 오늘) */
export function todayKst(at: Date): string {
  const p = kstParts(at);
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** 'YYYY-MM-DD HH:mm:ss' (KST 현재 시각) — edi.create_at 형식 */
export function nowKst(at: Date): string {
  const p = kstParts(at);
  return `${todayKst(at)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

/** 'YYYY-MM' (KST 현재 연월) */
export function currentYmKst(at: Date): string {
  const p = kstParts(at);
  return `${pad4(p.year)}-${pad2(p.month)}`;
}

/** 'YYYYMM' (저장소 키 등에 사용) */
export function compactYmKst(at: Date): string {
  return currentYmKst(at).replace('-', '');
}

const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YMD_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 'YYYY-MM' 형식이면서 PostgreSQL date 로 다룰 수 있는 연도(0001 이상)인지 — '0000-01' 은 DB 오류(500)가 나므로 거부 */
export function isValidYm(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = YM_RE.exec(value);
  return m !== null && Number(m[1]) >= 1;
}

/** 'YYYY-MM-DD' 형식이면서 실제 존재하는 날짜인지 */
export function isValidYmd(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = YMD_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function parseYm(ym: string): { year: number; month: number } {
  const m = YM_RE.exec(ym);
  if (!m) throw new RangeError(`잘못된 연월 형식: ${ym}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** 연월에 개월 수를 더한다. ymAdd('2026-01', -1) → '2025-12' */
export function ymAdd(ym: string, months: number): string {
  const { year, month } = parseYm(ym);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const mo = index - y * 12 + 1;
  return `${pad4(y)}-${pad2(mo)}`;
}

/** a - b (개월). ymDiff('2026-01', '2025-11') → 2 */
export function ymDiff(a: string, b: string): number {
  const pa = parseYm(a);
  const pb = parseYm(b);
  return pa.year * 12 + pa.month - (pb.year * 12 + pb.month);
}

/** 'YYYY-MM' → 'YYYY년 M월' */
export function ymDisplay(ym: string): string {
  const { year, month } = parseYm(ym);
  return `${year}년 ${month}월`;
}

/** 연월의 첫날 'YYYY-MM-01' 과 다음 달 첫날 — SQL 범위 조건(reg_ymd >= $1 AND reg_ymd < $2)에 사용 */
export function ymDateRange(ym: string): { from: string; toExclusive: string } {
  parseYm(ym);
  return { from: `${ym}-01`, toExclusive: `${ymAdd(ym, 1)}-01` };
}

/**
 * EDI 대상 월 라벨 (기존 업무 규칙): 오늘(KST) 기준 당월 = 직전 달, 전월 = 2개월 전, 전전월 = 3개월 전.
 */
export const EDI_MONTH_OFFSETS: ReadonlyArray<{ label: EdiMonthLabel; offset: number }> = [
  { label: '당월', offset: -1 },
  { label: '전월', offset: -2 },
  { label: '전전월', offset: -3 },
];

export function ediMonthOptions(at: Date): EdiMonthOptionsResponse {
  const base = currentYmKst(at);
  const options: EdiMonthOption[] = EDI_MONTH_OFFSETS.map(({ label, offset }) => {
    const ym = ymAdd(base, offset);
    return { label, ym, display: `${label} (${ymDisplay(ym)})` };
  });
  return { options, defaultLabel: '당월' };
}

/** targetYm 이 현재 선택 가능한 대상 월이면 해당 라벨, 아니면 null */
export function ediMonthLabelForYm(targetYm: string, at: Date): EdiMonthLabel | null {
  const found = ediMonthOptions(at).options.find((o) => o.ym === targetYm);
  return found ? found.label : null;
}

/** 저장된 라벨(edi.month)과 등록일(reg_ymd, 'YYYY-MM-DD')로 대상 연월을 역산한다. 알 수 없으면 null */
export function ediTargetYmFromLabel(label: string | null | undefined, regYmd: string | null | undefined): string | null {
  if (!label || !regYmd || !isValidYmd(regYmd)) return null;
  const entry = EDI_MONTH_OFFSETS.find((o) => o.label === label.trim());
  if (!entry) return null;
  return ymAdd(regYmd.slice(0, 7), entry.offset);
}
