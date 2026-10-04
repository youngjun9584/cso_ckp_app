/**
 * EDI 사진 검토 상태 표시 규칙 (DESIGN §2.5).
 * 상태 판정(pharmacist·deal_type)은 서버가 하고, 앱은 reviewStatus 를 라벨·색으로만 바꾼다.
 */
import type { BadgeTone, IconName } from '@/components/ui';
import type { EdiPhoto, EdiPhotoReviewStatus } from '@/lib/api';

export interface ReviewStatusMeta {
  label: string;
  tone: BadgeTone;
  icon: IconName;
}

/** 표시 순서: 검토필요 → 검토완료 → 삭제요청 → 삭제됨 */
export const REVIEW_STATUS_ORDER: readonly EdiPhotoReviewStatus[] = ['needs_review', 'reviewed', 'delete_requested', 'missing'];

export const REVIEW_STATUS_META: Record<EdiPhotoReviewStatus, ReviewStatusMeta> = {
  needs_review: { label: '검토필요', tone: 'warning', icon: 'time-outline' },
  reviewed: { label: '검토완료', tone: 'success', icon: 'checkmark-circle-outline' },
  delete_requested: { label: '삭제요청', tone: 'danger', icon: 'alert-circle-outline' },
  missing: { label: '삭제됨', tone: 'neutral', icon: 'trash-outline' },
};

/** 알 수 없는 값이 오면 '검토필요'로 취급한다 (관리자 기본 큐와 같은 쪽) */
function metaOf(status: EdiPhotoReviewStatus): ReviewStatusMeta {
  return REVIEW_STATUS_META[status] ?? REVIEW_STATUS_META.needs_review;
}

export function reviewStatusLabel(status: EdiPhotoReviewStatus): string {
  return metaOf(status).label;
}

export function reviewStatusTone(status: EdiPhotoReviewStatus): BadgeTone {
  return metaOf(status).tone;
}

export function reviewStatusIcon(status: EdiPhotoReviewStatus): IconName {
  return metaOf(status).icon;
}

/** 관리자가 사진(edi 행)을 지운 경우 */
export function isMissingPhoto(photo: Pick<EdiPhoto, 'reviewStatus'>): boolean {
  return photo.reviewStatus === 'missing';
}

/** 출력·AI 분석 등 보조 표시 */
export const PHOTO_FLAG_META = {
  printed: { label: '출력됨', tone: 'primary', icon: 'print-outline' },
  analyzed: { label: 'AI분석', tone: 'teal', icon: 'sparkles-outline' },
} as const satisfies Record<string, ReviewStatusMeta>;

export interface StatusCountItem extends ReviewStatusMeta {
  status: EdiPhotoReviewStatus;
  count: number;
}

/** 0이 아닌 상태만 표시 순서대로 (예: 검토필요 3 · 검토완료 2) */
export function statusCountItems(counts: Partial<Record<EdiPhotoReviewStatus, number>> | null | undefined): StatusCountItem[] {
  if (!counts) return [];
  return REVIEW_STATUS_ORDER.flatMap((status) => {
    const count = counts[status] ?? 0;
    return count > 0 ? [{ status, count, ...REVIEW_STATUS_META[status] }] : [];
  });
}

/** 스크린리더용 한 문장 (예: '검토필요 3장, 검토완료 2장') */
export function statusCountsSentence(counts: Partial<Record<EdiPhotoReviewStatus, number>> | null | undefined): string {
  return statusCountItems(counts)
    .map((item) => `${item.label} ${item.count}장`)
    .join(', ');
}

/** 사진 목록에서 상태별 개수 (서버 statusCounts 가 없을 때 대비) */
export function countReviewStatuses(photos: readonly Pick<EdiPhoto, 'reviewStatus'>[]): Record<EdiPhotoReviewStatus, number> {
  const counts: Record<EdiPhotoReviewStatus, number> = { needs_review: 0, reviewed: 0, delete_requested: 0, missing: 0 };
  for (const photo of photos) {
    if (photo.reviewStatus in counts) counts[photo.reviewStatus] += 1;
  }
  return counts;
}
