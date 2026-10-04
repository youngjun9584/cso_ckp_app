/**
 * 한국 표준시(KST, UTC+9) 날짜 도우미. 기기 시간대와 무관하게 동작한다.
 * 문자열 형식: 날짜 'YYYY-MM-DD', 시각 'YYYY-MM-DD HH:mm:ss', 연월 'YYYY-MM'.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad2 = (n: number) => String(n).padStart(2, '0');

interface KstParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function kstParts(date: Date = new Date()): KstParts {
  const d = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** 'YYYY-MM-DD' */
export function kstDate(date: Date = new Date()): string {
  const p = kstParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** 'YYYY-MM-DD HH:mm:ss' */
export function kstDateTime(date: Date = new Date()): string {
  const p = kstParts(date);
  return `${kstDate(date)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

/** 'YYYY-MM' */
export function kstYm(date: Date = new Date()): string {
  const p = kstParts(date);
  return `${p.year}-${pad2(p.month)}`;
}

export function parseYm(ym: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** 연월에 개월 수 더하기 ('2026-01', -1 → '2025-12') */
export function addMonths(ym: string, delta: number): string {
  const p = parseYm(ym);
  if (!p) return ym;
  const index = p.year * 12 + (p.month - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${pad2(month)}`;
}

/** '2026-08' → '2026년 8월' */
export function formatYm(ym: string | null | undefined): string {
  if (!ym) return '';
  const p = parseYm(ym);
  if (!p) return ym;
  return `${p.year}년 ${p.month}월`;
}

/** 날짜 문자열에서 'YYYY-MM-DD' 부분만 (값이 없으면 빈 문자열) */
export function formatYmd(ymd: string | null | undefined): string {
  if (!ymd) return '';
  return /^\d{4}-\d{2}-\d{2}/.test(ymd) ? ymd.slice(0, 10) : ymd;
}

/** 'YYYY-MM-DD HH:mm:ss' → 'YYYY-MM-DD HH:mm' */
export function formatDateTimeShort(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(value);
  return m ? `${m[1]} ${m[2]}` : value;
}
