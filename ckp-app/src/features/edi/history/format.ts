/** EDI 등록 내역 표시용 문구 */
import type { EdiSubmissionSummary } from '@/lib/api';
import { formatDateTimeShort, formatYm, formatYmd } from '@/lib/kst';

/** 목록 카드용 짧은 대상월: '당월(2026-08)' / '당월' / '2026-08' / '' */
export function targetMonthShort(s: Pick<EdiSubmissionSummary, 'monthLabel' | 'targetYm'>): string {
  const label = s.monthLabel?.trim();
  if (label && s.targetYm) return `${label}(${s.targetYm})`;
  return label || s.targetYm || '';
}

/** 상세용 대상 연월: '당월 (2026년 8월)' / '당월' / '2026년 8월' / '' */
export function targetMonthLong(s: Pick<EdiSubmissionSummary, 'monthLabel' | 'targetYm'>): string {
  const label = s.monthLabel?.trim();
  if (label && s.targetYm) return `${label} (${formatYm(s.targetYm)})`;
  return label || formatYm(s.targetYm);
}

/** 등록 시각 'YYYY-MM-DD HH:mm' (시각이 없으면 등록일만) */
export function submittedAtText(s: Pick<EdiSubmissionSummary, 'createdAt' | 'regYmd'>): string {
  return formatDateTimeShort(s.createdAt) || formatYmd(s.regYmd);
}

/** 여러 줄 메모를 한 줄 미리보기로 */
export function memoPreview(memo: string | null | undefined): string {
  return (memo ?? '').replace(/\s+/g, ' ').trim();
}

export function photoCountText(count: number): string {
  return `사진 ${count}장`;
}
