/**
 * 관리자 화면과 같은 EDI 사진 상태 규칙 + 이전 방식 등록분 묶음 규칙.
 */
import { createHash } from 'node:crypto';
import type { EdiPhotoReviewStatus } from '../../contract.js';
import { nowKst } from '../../lib/kst.js';

export const DELETE_REQUEST_DEAL_TYPE = '삭제요청';

/**
 * 검토 상태. 관리자(lab/ediMangement/management.vue) 판정식을 그대로 옮겼다:
 *   pharmacist.split(',').length === 1 && pharmacist.trim() !== '' && !/^\d+$/.test(pharmacist) → 검토완료
 * (NULL 은 관리자 화면에서 '' 로 직렬화되므로 검토필요). deal_type '삭제요청' 이면 삭제요청이 우선한다.
 */
export function reviewStatus(dealType: string | null, pharmacist: string | null): Exclude<EdiPhotoReviewStatus, 'missing'> {
  if (dealType !== null && dealType.trim() === DELETE_REQUEST_DEAL_TYPE) return 'delete_requested';
  const p = pharmacist ?? '';
  const reviewed = p.split(',').length === 1 && p.trim() !== '' && !/^\d+$/.test(p);
  return reviewed ? 'reviewed' : 'needs_review';
}

/** 관리자가 지정한 제약사 목록 (쉼표 구분, 빈 항목 제외) */
export function pharmaCompanies(pharmacist: string | null): string[] {
  if (!pharmacist) return [];
  return pharmacist
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function emptyStatusCounts(): Record<EdiPhotoReviewStatus, number> {
  return { needs_review: 0, reviewed: 0, delete_requested: 0, missing: 0 };
}

/**
 * edi.create_at(문자열) → KST 'YYYY-MM-DD HH:mm:ss'. 관리자 화면이 받아들이는 형식을 처리한다:
 * 'YYYY-MM-DD HH:mm:ss'(앱/Next.js, KST), 10자리 유닉스 초, 13자리 밀리초, 시간대가 붙은 ISO 문자열.
 * 해석할 수 없으면 null.
 */
export function normalizeCreateAt(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = raw.trim();
  if (v === '') return null;
  let m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/.exec(v);
  if (m) return `${m[1]} ${m[2]}`;
  m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(v);
  if (m) return `${m[1]} ${m[2]}:00`;
  if (/^\d{10}$/.test(v)) return nowKst(new Date(Number(v) * 1000));
  if (/^\d{13}$/.test(v)) return nowKst(new Date(Number(v)));
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(v)) {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return nowKst(new Date(ms));
  }
  return null;
}

/** 이전 방식 등록분 묶음 키 (edi 행의 원문 값 — NULL 과 '' 는 서로 다른 묶음) */
export interface LegacyGroupKey {
  hospitalName: string | null;
  month: string | null;
  createAt: string | null;
  regYmd: string;
}

/**
 * legacy id = 'legacy-' + sha1(사용자·거래처·월·등록시각·등록일) 앞 24자.
 * 구분자 충돌을 피하려고 JSON 배열로 직렬화한다(NULL 은 null 로 남음).
 */
export function legacyGroupId(usrId: string, key: LegacyGroupKey): string {
  const material = JSON.stringify([usrId, key.hospitalName, key.month, key.createAt, key.regYmd]);
  return `legacy-${createHash('sha1').update(material, 'utf8').digest('hex').slice(0, 24)}`;
}

export const LEGACY_ID_RE = /^legacy-[0-9a-f]{24}$/;

export function legacyGroupMapKey(key: LegacyGroupKey): string {
  return JSON.stringify([key.hospitalName, key.month, key.createAt, key.regYmd]);
}
