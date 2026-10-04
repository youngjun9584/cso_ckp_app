/**
 * EDI 등록 내역 (DESIGN §5.7)
 *  - 앱 제출 건: ckp_app_edi_submission(usr_id 기준) + submission_photo(seq) ↔ edi(LEFT JOIN, 없으면 missing)
 *  - 이전 방식 등록분: 같은 edi.user_id, 관리자 복사본(is_copy) 제외, 앱 제출에 속하지 않은 edi 행을
 *    (hospital_name, month, create_at, reg_ymd) 로 묶은 legacy 그룹 (사진 순서 = idx 오름차순)
 *  - 등록월(reg_ymd, KST 날짜) 기준, 최신순: 등록일 → 등록시각 → 마지막 edi.idx
 * 월 단위로 사용자 행을 모두 읽어 JS 에서 묶고 정렬·페이지를 나눈다(한 사용자·한 달 규모는 수백~수천 행).
 */
import type { Capabilities } from '../../db/schema-check.js';
import type {
  EdiPhoto,
  EdiPhotoReviewStatus,
  EdiSubmissionDetail,
  EdiSubmissionListResponse,
  EdiSubmissionSummary,
} from '../../contract.js';
import type { Queryable } from '../../db/pool.js';
import { ediTargetYmFromLabel, ymDateRange } from '../../lib/kst.js';
import { paged, pageOffset, type PagingQuery } from '../../lib/validation.js';
import { isUuid, normalizeUuid, type PhotoUrlSigner } from './common.js';
import {
  LEGACY_ID_RE,
  emptyStatusCounts,
  legacyGroupId,
  legacyGroupMapKey,
  normalizeCreateAt,
  pharmaCompanies,
  reviewStatus,
  type LegacyGroupKey,
} from './review.js';

export const LEGACY_CLIENT_NAME_FALLBACK = '거래처 정보 없음';

// ───────────────────────── 사진 상태 ─────────────────────────

interface EdiStateRow {
  deal_type: string | null;
  pharmacist: string | null;
  print: boolean | null;
  is_ocr: boolean | null;
  has_image: boolean | null;
}

interface PhotoState {
  seq: number;
  ediIdx: number;
  present: boolean;
  hasImage: boolean;
  status: EdiPhotoReviewStatus;
  printed: boolean;
  analyzed: boolean;
  companies: string[];
}

function photoState(seq: number, ediIdx: number, row: EdiStateRow | null): PhotoState {
  if (!row) {
    return { seq, ediIdx, present: false, hasImage: false, status: 'missing', printed: false, analyzed: false, companies: [] };
  }
  return {
    seq,
    ediIdx,
    present: true,
    hasImage: row.has_image === true,
    status: reviewStatus(row.deal_type, row.pharmacist),
    printed: row.print === true,
    analyzed: row.is_ocr === true,
    companies: pharmaCompanies(row.pharmacist),
  };
}

function photoDto(p: PhotoState, signer: PhotoUrlSigner): EdiPhoto {
  const viewable = p.present && p.hasImage;
  return {
    seq: p.seq,
    ediIdx: p.ediIdx,
    thumbUrl: viewable ? signer.edi(p.ediIdx, 'thumb') : null,
    imageUrl: viewable ? signer.edi(p.ediIdx, 'full') : null,
    reviewStatus: p.status,
    printed: p.printed,
    analyzed: p.analyzed,
    pharmaCompanies: p.companies,
  };
}

function statusCounts(photos: PhotoState[]): Record<EdiPhotoReviewStatus, number> {
  const counts = emptyStatusCounts();
  for (const p of photos) counts[p.status] += 1;
  return counts;
}

function coverThumb(photos: PhotoState[], signer: PhotoUrlSigner): string | null {
  const first = photos.find((p) => p.present && p.hasImage);
  return first ? signer.edi(first.ediIdx, 'thumb') : null;
}

const EDI_STATE_COLUMNS = `e.deal_type, e.pharmacist, e.print, e.is_ocr, (e.aws_url IS NOT NULL OR e.edi_image IS NOT NULL) AS has_image`;

// ───────────────────────── 앱 제출 건 ─────────────────────────

interface AppSubmissionRow {
  submission_id: string;
  client_idx: number;
  client_name: string;
  target_ym: string;
  month_label: string;
  memo: string | null;
  photo_count: number;
  create_at_kst: string;
  reg_ymd: string;
  request_hash: string;
}

interface AppPhotoRow extends EdiStateRow {
  submission_id: string;
  seq: number;
  edi_idx: number;
  e_idx: number | null;
}

const SUBMISSION_COLUMNS = `s.submission_id::text AS submission_id, s.client_idx, s.client_name, s.target_ym, s.month_label, s.memo,
  s.photo_count, s.create_at_kst, to_char(s.reg_ymd, 'YYYY-MM-DD') AS reg_ymd, s.request_hash`;

const APP_PHOTO_COLUMNS = `p.submission_id::text AS submission_id, p.seq, p.edi_idx, e.idx AS e_idx, ${EDI_STATE_COLUMNS}`;

function appPhotoStates(rows: AppPhotoRow[]): PhotoState[] {
  return rows.map((r) => photoState(r.seq, r.edi_idx, r.e_idx === null ? null : r));
}

function appSummary(s: AppSubmissionRow, photos: PhotoState[], signer: PhotoUrlSigner): EdiSubmissionSummary {
  return {
    id: s.submission_id,
    kind: 'app',
    clientIdx: s.client_idx,
    clientName: s.client_name,
    targetYm: s.target_ym.trim(),
    monthLabel: s.month_label,
    memo: s.memo,
    photoCount: s.photo_count,
    createdAt: s.create_at_kst,
    regYmd: s.reg_ymd,
    coverThumbUrl: coverThumb(photos, signer),
    statusCounts: statusCounts(photos),
  };
}

export interface AppSubmissionDetail extends EdiSubmissionDetail {
  /** 내부용 (응답에서 제외) */
  requestHash: string;
}

/** 앱 제출 건 상세 (소유자 아니면 null). 트랜잭션 안에서도 쓸 수 있도록 Queryable 을 받는다 */
export async function loadAppSubmission(
  q: Queryable,
  usrId: string,
  submissionId: string,
  signer: PhotoUrlSigner,
): Promise<AppSubmissionDetail | null> {
  const { rows } = await q.query<AppSubmissionRow>(
    `SELECT ${SUBMISSION_COLUMNS} FROM public.ckp_app_edi_submission s WHERE s.submission_id = $1::uuid AND s.usr_id = $2`,
    [submissionId, usrId],
  );
  const s = rows[0];
  if (!s) return null;
  const photoRows = await q.query<AppPhotoRow>(
    `SELECT ${APP_PHOTO_COLUMNS}
       FROM public.ckp_app_edi_submission_photo p
       LEFT JOIN public.edi e ON e.idx = p.edi_idx
      WHERE p.submission_id = $1::uuid
      ORDER BY p.seq`,
    [s.submission_id],
  );
  const photos = appPhotoStates(photoRows.rows);
  return {
    ...appSummary(s, photos, signer),
    photos: photos.map((p) => photoDto(p, signer)),
    requestHash: s.request_hash.trim(),
  };
}

/** 응답용 (내부 필드 제거) */
export function publicDetail(d: AppSubmissionDetail): EdiSubmissionDetail {
  const { requestHash: _omit, ...rest } = d;
  void _omit;
  return rest;
}

// ───────────────────────── 이전 방식 등록분 ─────────────────────────

interface LegacyRow extends EdiStateRow {
  idx: number;
  hospital_name: string | null;
  month: string | null;
  create_at: string | null;
  reg_ymd: string;
}

interface LegacyGroup {
  key: LegacyGroupKey;
  rows: LegacyRow[];
}

function legacyFilters(caps: Capabilities): string {
  const copy = caps.ediIsCopy ? 'AND COALESCE(e.is_copy, false) = false' : '';
  return `${copy}
    AND NOT EXISTS (SELECT 1 FROM public.ckp_app_edi_submission_photo x WHERE x.edi_idx = e.idx)`;
}

const LEGACY_COLUMNS = `e.idx, e.hospital_name, e.month, e.create_at, to_char(e.reg_ymd, 'YYYY-MM-DD') AS reg_ymd, ${EDI_STATE_COLUMNS}`;

function groupLegacy(rows: LegacyRow[]): LegacyGroup[] {
  const groups = new Map<string, LegacyGroup>();
  for (const r of rows) {
    const key: LegacyGroupKey = { hospitalName: r.hospital_name, month: r.month, createAt: r.create_at, regYmd: r.reg_ymd };
    const k = legacyGroupMapKey(key);
    let g = groups.get(k);
    if (!g) {
      g = { key, rows: [] };
      groups.set(k, g);
    }
    g.rows.push(r);
  }
  for (const g of groups.values()) g.rows.sort((a, b) => a.idx - b.idx);
  return [...groups.values()];
}

function legacyPhotoStates(g: LegacyGroup): PhotoState[] {
  return g.rows.map((r, i) => photoState(i + 1, r.idx, r));
}

/** 거래처명 → 내 거래처 idx (같은 이름이 여러 개면 가장 작은 idx) */
async function clientIdxByName(q: Queryable, usrId: string, names: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return new Map();
  const { rows } = await q.query<{ hospital: string; idx: number }>(
    `SELECT hospital, min(idx)::int AS idx FROM public.mannager_by_hospital
      WHERE user_id = $1 AND hospital = ANY($2::text[]) GROUP BY hospital`,
    [usrId, unique],
  );
  return new Map(rows.map((r) => [r.hospital, r.idx]));
}

function legacySummary(usrId: string, g: LegacyGroup, photos: PhotoState[], clientIdx: number | null, signer: PhotoUrlSigner): EdiSubmissionSummary {
  const month = g.key.month?.trim() ? g.key.month.trim() : null;
  return {
    id: legacyGroupId(usrId, g.key),
    kind: 'legacy',
    clientIdx,
    clientName: g.key.hospitalName?.trim() ? g.key.hospitalName : LEGACY_CLIENT_NAME_FALLBACK,
    targetYm: ediTargetYmFromLabel(month, g.key.regYmd),
    monthLabel: month,
    memo: null,
    photoCount: g.rows.length,
    createdAt: normalizeCreateAt(g.key.createAt),
    regYmd: g.key.regYmd,
    coverThumbUrl: coverThumb(photos, signer),
    statusCounts: statusCounts(photos),
  };
}

async function loadLegacyGroup(
  q: Queryable,
  caps: Capabilities,
  usrId: string,
  id: string,
  signer: PhotoUrlSigner,
): Promise<EdiSubmissionDetail | null> {
  // 해시는 되돌릴 수 없으므로 사용자의 묶음 키 목록에서 같은 규칙으로 다시 찾는다
  const keys = await q.query<{ hospital_name: string | null; month: string | null; create_at: string | null; reg_ymd: string }>(
    `SELECT DISTINCT e.hospital_name, e.month, e.create_at, to_char(e.reg_ymd, 'YYYY-MM-DD') AS reg_ymd
       FROM public.edi e
      WHERE e.user_id = $1 AND e.reg_ymd IS NOT NULL ${legacyFilters(caps)}`,
    [usrId],
  );
  const found = keys.rows
    .map((r): LegacyGroupKey => ({ hospitalName: r.hospital_name, month: r.month, createAt: r.create_at, regYmd: r.reg_ymd }))
    .find((k) => legacyGroupId(usrId, k) === id);
  if (!found) return null;

  const { rows } = await q.query<LegacyRow>(
    `SELECT ${LEGACY_COLUMNS}
       FROM public.edi e
      WHERE e.user_id = $1
        AND e.hospital_name IS NOT DISTINCT FROM $2::text
        AND e.month IS NOT DISTINCT FROM $3::text
        AND e.create_at IS NOT DISTINCT FROM $4::text
        AND e.reg_ymd = $5::date
        ${legacyFilters(caps)}
      ORDER BY e.idx`,
    [usrId, found.hospitalName, found.month, found.createAt, found.regYmd],
  );
  if (rows.length === 0) return null;
  const group: LegacyGroup = { key: found, rows };
  const photos = legacyPhotoStates(group);
  const names = found.hospitalName ? await clientIdxByName(q, usrId, [found.hospitalName]) : new Map<string, number>();
  const clientIdx = found.hospitalName ? (names.get(found.hospitalName) ?? null) : null;
  return {
    ...legacySummary(usrId, group, photos, clientIdx, signer),
    photos: photos.map((p) => photoDto(p, signer)),
  };
}

// ───────────────────────── 공개 함수 ─────────────────────────

/** 상세: 앱 제출 건(uuid) 또는 legacy-<해시>. 없거나 다른 사용자 것이면 null */
export async function getSubmissionDetail(
  q: Queryable,
  caps: Capabilities,
  usrId: string,
  id: string,
  signer: PhotoUrlSigner,
): Promise<EdiSubmissionDetail | null> {
  if (isUuid(id)) {
    const d = await loadAppSubmission(q, usrId, normalizeUuid(id), signer);
    return d ? publicDetail(d) : null;
  }
  if (LEGACY_ID_RE.test(id)) return loadLegacyGroup(q, caps, usrId, id, signer);
  return null;
}

interface ListEntry {
  regYmd: string;
  createdAt: string | null;
  lastEdiIdx: number;
  build: () => EdiSubmissionSummary;
}

function compareEntries(a: ListEntry, b: ListEntry): number {
  if (a.regYmd !== b.regYmd) return a.regYmd < b.regYmd ? 1 : -1;
  const ca = a.createdAt ?? '';
  const cb = b.createdAt ?? '';
  if (ca !== cb) return ca < cb ? 1 : -1;
  return b.lastEdiIdx - a.lastEdiIdx;
}

/** 목록: 등록월(ym) 의 앱 제출 건 + 이전 방식 묶음, 최신순 */
export async function listSubmissions(
  q: Queryable,
  caps: Capabilities,
  usrId: string,
  ym: string,
  paging: PagingQuery,
  signer: PhotoUrlSigner,
): Promise<EdiSubmissionListResponse> {
  const { from, toExclusive } = ymDateRange(ym);

  const subs = await q.query<AppSubmissionRow>(
    `SELECT ${SUBMISSION_COLUMNS} FROM public.ckp_app_edi_submission s
      WHERE s.usr_id = $1 AND s.reg_ymd >= $2::date AND s.reg_ymd < $3::date`,
    [usrId, from, toExclusive],
  );
  const appPhotos = await q.query<AppPhotoRow>(
    `SELECT ${APP_PHOTO_COLUMNS}
       FROM public.ckp_app_edi_submission_photo p
       JOIN public.ckp_app_edi_submission s ON s.submission_id = p.submission_id
       LEFT JOIN public.edi e ON e.idx = p.edi_idx
      WHERE s.usr_id = $1 AND s.reg_ymd >= $2::date AND s.reg_ymd < $3::date
      ORDER BY p.submission_id, p.seq`,
    [usrId, from, toExclusive],
  );
  const legacyRows = await q.query<LegacyRow>(
    `SELECT ${LEGACY_COLUMNS}
       FROM public.edi e
      WHERE e.user_id = $1 AND e.reg_ymd >= $2::date AND e.reg_ymd < $3::date ${legacyFilters(caps)}
      ORDER BY e.idx`,
    [usrId, from, toExclusive],
  );

  const photosBySubmission = new Map<string, AppPhotoRow[]>();
  for (const r of appPhotos.rows) {
    const list = photosBySubmission.get(r.submission_id) ?? [];
    list.push(r);
    photosBySubmission.set(r.submission_id, list);
  }

  const groups = groupLegacy(legacyRows.rows);
  const names = await clientIdxByName(
    q,
    usrId,
    groups.map((g) => g.key.hospitalName).filter((n): n is string => typeof n === 'string' && n.length > 0),
  );

  const entries: ListEntry[] = [];
  for (const s of subs.rows) {
    const rows = photosBySubmission.get(s.submission_id) ?? [];
    const photos = appPhotoStates(rows);
    entries.push({
      regYmd: s.reg_ymd,
      createdAt: s.create_at_kst,
      lastEdiIdx: rows.reduce((m, r) => Math.max(m, r.edi_idx), 0),
      build: () => appSummary(s, photos, signer),
    });
  }
  for (const g of groups) {
    const photos = legacyPhotoStates(g);
    const clientIdx = g.key.hospitalName ? (names.get(g.key.hospitalName) ?? null) : null;
    entries.push({
      regYmd: g.key.regYmd,
      createdAt: normalizeCreateAt(g.key.createAt),
      lastEdiIdx: g.rows.reduce((m, r) => Math.max(m, r.idx), 0),
      build: () => legacySummary(usrId, g, photos, clientIdx, signer),
    });
  }

  entries.sort(compareEntries);
  const { limit, offset } = pageOffset(paging);
  const items = entries.slice(offset, offset + limit).map((e) => e.build());
  return paged(items, paging, entries.length);
}
