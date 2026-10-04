/** 샘플 EDI: 대상 연월 계산(KST) + 등록 내역 시드 */
import type {
  ClientDetail,
  EdiMonthLabel,
  EdiMonthOptionsResponse,
  EdiPhoto,
  EdiPhotoReviewStatus,
  EdiSubmissionDetail,
} from '../contract';
import { SAMPLE_EDI_IMAGES } from './images';
import { addMonths, formatYm, kstDate, kstDateTime, kstYm } from '@/lib/kst';

const LABELS: EdiMonthLabel[] = ['당월', '전월', '전전월'];

/** 기존 업무 기준: 오늘(KST) 기준 당월 = 직전 달, 전월 = 2개월 전, 전전월 = 3개월 전 */
export function buildMonthOptions(now: Date = new Date()): EdiMonthOptionsResponse {
  const thisYm = kstYm(now);
  return {
    options: LABELS.map((label, i) => {
      const ym = addMonths(thisYm, -(i + 1));
      return { label, ym, display: `${label} (${formatYm(ym)})` };
    }),
    defaultLabel: '당월',
  };
}

/** 등록일 기준 대상 연월의 라벨 */
export function monthLabelFor(regYmd: string, targetYm: string): EdiMonthLabel | null {
  const regYm = regYmd.slice(0, 7);
  for (let i = 0; i < LABELS.length; i += 1) {
    if (addMonths(regYm, -(i + 1)) === targetYm) return LABELS[i];
  }
  return null;
}

export function countStatuses(photos: EdiPhoto[]): Record<EdiPhotoReviewStatus, number> {
  const counts: Record<EdiPhotoReviewStatus, number> = { needs_review: 0, reviewed: 0, delete_requested: 0, missing: 0 };
  for (const p of photos) counts[p.reviewStatus] += 1;
  return counts;
}

interface SubmissionSeed {
  hoursAgo: number;
  clientIndex: number;
  label: EdiMonthLabel;
  statuses: EdiPhotoReviewStatus[];
  memo?: string;
  legacy?: boolean;
}

const SEEDS: SubmissionSeed[] = [
  { hoursAgo: 3, clientIndex: 0, label: '당월', statuses: ['needs_review', 'needs_review', 'needs_review', 'needs_review'], memo: '9월 넷째 주 처방분' },
  { hoursAgo: 27, clientIndex: 1, label: '당월', statuses: ['reviewed', 'reviewed', 'needs_review', 'needs_review', 'needs_review', 'needs_review', 'needs_review'] },
  { hoursAgo: 76, clientIndex: 2, label: '전월', statuses: ['reviewed', 'delete_requested', 'missing'], legacy: true },
  { hoursAgo: 24 * 9, clientIndex: 3, label: '당월', statuses: ['reviewed', 'reviewed', 'reviewed', 'reviewed', 'reviewed'], memo: '원장님 확인 완료' },
  { hoursAgo: 24 * 21, clientIndex: 0, label: '전월', statuses: ['reviewed', 'reviewed'] },
  { hoursAgo: 24 * 34, clientIndex: 5, label: '당월', statuses: ['reviewed', 'reviewed', 'reviewed', 'needs_review', 'reviewed', 'reviewed'] },
  { hoursAgo: 24 * 40, clientIndex: 8, label: '당월', statuses: ['reviewed', 'reviewed', 'reviewed'], legacy: true },
  { hoursAgo: 24 * 57, clientIndex: 11, label: '전전월', statuses: ['reviewed', 'delete_requested'] },
];

const PHARMA = ['한결제약', '다온약품', '새빛바이오', '청명약품'];

export function buildSampleSubmissions(clients: ClientDetail[], nextEdiIdx: () => number): EdiSubmissionDetail[] {
  const now = Date.now();
  return SEEDS.map((seed, n) => {
    const created = new Date(now - seed.hoursAgo * 3_600_000);
    const regYmd = kstDate(created);
    const createdAt = kstDateTime(created);
    const labelIndex = LABELS.indexOf(seed.label);
    const targetYm = addMonths(kstYm(created), -(labelIndex + 1));
    const client = clients[seed.clientIndex % clients.length];
    const photos: EdiPhoto[] = seed.statuses.map((status, i) => {
      const image = SAMPLE_EDI_IMAGES[(n + i) % SAMPLE_EDI_IMAGES.length];
      const missing = status === 'missing';
      return {
        seq: i + 1,
        ediIdx: missing ? null : nextEdiIdx(),
        thumbUrl: missing ? null : image,
        imageUrl: missing ? null : image,
        reviewStatus: status,
        printed: status === 'reviewed' && i % 2 === 0,
        analyzed: status !== 'needs_review' && !missing,
        pharmaCompanies: status === 'reviewed' ? [PHARMA[(n + i) % PHARMA.length]] : [],
      };
    });
    const legacyId = `legacy-${(0x5a17c0de + n * 7919).toString(16).padStart(12, '0')}${String(n).padStart(12, '0')}`.slice(0, 31);
    return {
      id: seed.legacy ? legacyId : `5a3f1c2e-0000-4000-8000-${String(n + 1).padStart(12, '0')}`,
      kind: seed.legacy ? 'legacy' : 'app',
      clientIdx: seed.legacy ? null : client.idx,
      clientName: client.name,
      targetYm: seed.legacy ? null : targetYm,
      monthLabel: seed.label,
      memo: seed.legacy ? null : (seed.memo ?? null),
      photoCount: photos.length,
      createdAt,
      regYmd,
      coverThumbUrl: photos.find((p) => p.thumbUrl)?.thumbUrl ?? null,
      statusCounts: countStatuses(photos),
      photos,
    };
  });
}
