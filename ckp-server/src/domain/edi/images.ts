/**
 * 서명 토큰(GET /v1/files/:token) → 이미지 바이트. DESIGN §5.7
 *  'u' 업로드 원장: object/thumb 키를 저장소에서 읽는다.
 *  'e' edi 행(소유 확인): 현재 edi.aws_url 기준
 *     1) 이 서버 저장소의 URL(S3 공개 URL 또는 'local:' 키) → 저장소에서 읽기
 *     2) LEGACY_IMAGE_URL_PREFIXES 로 시작하는 https → 서버가 가져와 전달(10MB·10초, 리다이렉트 불허)
 *     3) edi_image(bytea 에 담긴 data URL) → 디코드
 *   썸네일: 앱 업로드 객체면 저장된 _thumb, 아니면 즉석 생성(작은 메모리 캐시 — 실제로 만든 512KB 이하 썸네일만).
 *  그 외(형식 불명·소유 불일치·삭제됨) → null (라우트가 404).
 */
import type { FastifyBaseLogger } from 'fastify';
import type { RouteDeps } from '../../app.js';
import type { Queryable } from '../../db/pool.js';
import { makeThumbnail, makeThumbnailLenient, sniffImageType } from '../../lib/image.js';
import type { FileTokenPayload } from '../../lib/tokens.js';
import { ediSchemaReady, isUuid, normalizeUuid } from './common.js';

export const LEGACY_FETCH_MAX_BYTES = 10 * 1024 * 1024;
export const LEGACY_FETCH_TIMEOUT_MS = 10_000;

export interface ImagePayload {
  buffer: Buffer;
  contentType: string;
}

type Deps = Pick<RouteDeps, 'db' | 'storage' | 'config' | 'capabilities'>;

const SERVABLE: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** 알려진 이미지 형식일 때만 전달한다(임의 바이트를 image/* 로 내보내지 않음) */
function typed(buffer: Buffer | null): ImagePayload | null {
  if (!buffer || buffer.length === 0) return null;
  const t = sniffImageType(buffer);
  const contentType = t ? SERVABLE[t] : undefined;
  return contentType ? { buffer, contentType } : null;
}

// ───────────────────────── 썸네일 캐시 ─────────────────────────

const THUMB_CACHE_MAX = 200;
/** 캐시에 넣을 수 있는 썸네일 최대 크기 — "작은 메모리 캐시"가 원본 크기 이미지로 커지지 않도록 */
export const THUMB_CACHE_MAX_BYTES = 512 * 1024;
const thumbCache = new Map<string, ImagePayload>();

function cacheGet(key: string): ImagePayload | undefined {
  const hit = thumbCache.get(key);
  if (hit) {
    thumbCache.delete(key);
    thumbCache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: ImagePayload): void {
  thumbCache.set(key, value);
  if (thumbCache.size > THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value;
    if (oldest !== undefined) thumbCache.delete(oldest);
  }
}

interface ThumbResult {
  payload: ImagePayload;
  /** true: 실제로 480px 썸네일을 만들었다 / false: 만들지 못해 원본을 그대로 전달 (캐시 금지) */
  generated: boolean;
}

/**
 * 즉석 썸네일. 엄격한 설정(1억 화소·손상 거부)으로 실패하면 느슨한 설정(3억 화소·손상 무시)으로 한 번 더 시도한다
 * (초고화소 원본, 끝이 잘린 JPEG 등). 둘 다 실패하면 원본을 전달하되 캐시하지 않는다.
 */
async function toThumb(full: ImagePayload, log: FastifyBaseLogger): Promise<ThumbResult> {
  try {
    const t = await makeThumbnail(full.buffer);
    return { payload: { buffer: t.buffer, contentType: t.contentType }, generated: true };
  } catch (strictErr) {
    try {
      const t = await makeThumbnailLenient(full.buffer);
      log.info({ reason: (strictErr as Error)?.message }, '썸네일을 느슨한 설정으로 다시 만들었습니다');
      return { payload: { buffer: t.buffer, contentType: t.contentType }, generated: true };
    } catch (err) {
      log.warn({ err, bytes: full.buffer.length }, '썸네일 생성 실패 — 원본을 전달합니다(캐시하지 않음)');
      return { payload: full, generated: false };
    }
  }
}

// ───────────────────────── 외부(이전 방식) URL ─────────────────────────

/** 허용 접두어와 같은 출처이고 경로가 접두어로 시작하는 https URL 인지 (문자열 접두어 비교의 호스트 우회 방지) */
export function isAllowedLegacyUrl(url: string, prefixes: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  return prefixes.some((prefix) => {
    let p: URL;
    try {
      p = new URL(prefix);
    } catch {
      return false;
    }
    if (p.protocol !== 'https:' || p.host !== u.host) return false;
    const base = p.pathname.endsWith('/') ? p.pathname : `${p.pathname}/`;
    return p.pathname === '/' || u.pathname === p.pathname || u.pathname.startsWith(base);
  });
}

async function fetchLegacy(url: string, log: FastifyBaseLogger): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'image/*' },
      signal: AbortSignal.timeout(LEGACY_FETCH_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) {
      log.info({ status: res.status }, '이전 방식 이미지 가져오기 실패');
      return null;
    }
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > LEGACY_FETCH_MAX_BYTES) {
      await res.body.cancel().catch(() => undefined);
      return null;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > LEGACY_FETCH_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        log.info('이전 방식 이미지가 10MB 를 넘어 전달하지 않습니다');
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    log.info({ reason: (err as Error)?.name }, '이전 방식 이미지 가져오기 오류');
    return null;
  }
}

// ───────────────────────── edi_image (data URL) ─────────────────────────

/** bytea 에 담긴 'data:image/...;base64,...' 문자열(관리자·구 앱 방식) 또는 원시 이미지 바이트 */
export function decodeEdiImage(raw: Buffer): Buffer | null {
  const head = raw.subarray(0, 64).toString('latin1');
  if (/^data:/i.test(head)) {
    const text = raw.toString('latin1');
    const comma = text.indexOf(',');
    if (comma < 0) return null;
    const meta = text.slice(5, comma);
    if (!/;base64$/i.test(meta)) return null;
    const b64 = text.slice(comma + 1).replace(/\s+/g, '');
    const buf = Buffer.from(b64, 'base64');
    return buf.length > 0 ? buf : null;
  }
  return sniffImageType(raw) ? raw : null;
}

// ───────────────────────── 조회 ─────────────────────────

interface UploadFileRow {
  usr_id: string;
  storage_driver: string;
  object_key: string;
  thumb_key: string;
  status: string;
}

async function uploadImage(deps: Deps, payload: FileTokenPayload, log: FastifyBaseLogger): Promise<ImagePayload | null> {
  if (!deps.capabilities.ediAppTables || typeof payload.id !== 'string' || !isUuid(payload.id)) return null;
  const { rows } = await deps.db.query<UploadFileRow>(
    `SELECT usr_id, storage_driver, object_key, thumb_key, status FROM public.ckp_app_edi_upload WHERE upload_id = $1::uuid`,
    [normalizeUuid(payload.id)],
  );
  const r = rows[0];
  if (!r || r.usr_id !== payload.u || r.status === 'DELETED' || r.storage_driver !== deps.storage.driver) return null;
  if (payload.v === 'thumb') {
    const thumb = typed(await deps.storage.getBuffer(r.thumb_key));
    if (thumb) return thumb;
  }
  const full = typed(await deps.storage.getBuffer(r.object_key));
  if (!full) return null;
  return payload.v === 'thumb' ? (await toThumb(full, log)).payload : full;
}

interface EdiFileRow {
  idx: number;
  aws_url: string | null;
  has_data: boolean;
}

function ediIdxOf(id: string | number): number | null {
  const n = typeof id === 'number' ? id : /^\d{1,10}$/.test(id) ? Number(id) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

async function ediOwned(q: Queryable, deps: Deps, idx: number, usrId: string): Promise<EdiFileRow | null> {
  // 토큰 사용자의 edi 행이거나, 그 사용자가 앱으로 제출한 사진(관리자가 담당자를 바꾼 경우)
  const viaApp = ediSchemaReady(deps.capabilities)
    ? `OR EXISTS (SELECT 1 FROM public.ckp_app_edi_submission_photo p
                    JOIN public.ckp_app_edi_submission s ON s.submission_id = p.submission_id
                   WHERE p.edi_idx = e.idx AND s.usr_id = $2)`
    : '';
  const { rows } = await q.query<EdiFileRow>(
    `SELECT e.idx, e.aws_url, (e.edi_image IS NOT NULL) AS has_data
       FROM public.edi e
      WHERE e.idx = $1 AND (e.user_id = $2 ${viaApp})`,
    [idx, usrId],
  );
  return rows[0] ?? null;
}

async function storedThumbForKey(deps: Deps, key: string): Promise<ImagePayload | null> {
  if (!deps.capabilities.ediAppTables) return null;
  const { rows } = await deps.db.query<{ thumb_key: string }>(
    `SELECT thumb_key FROM public.ckp_app_edi_upload WHERE object_key = $1 AND storage_driver = $2`,
    [key, deps.storage.driver],
  );
  const thumbKey = rows[0]?.thumb_key;
  return thumbKey ? typed(await deps.storage.getBuffer(thumbKey)) : null;
}

async function ediFullImage(deps: Deps, row: EdiFileRow, log: FastifyBaseLogger): Promise<ImagePayload | null> {
  const url = row.aws_url?.trim() || null;
  if (url) {
    const key = deps.storage.keyFromUrl(url);
    if (key) {
      try {
        const got = typed(await deps.storage.getBuffer(key));
        if (got) return got;
      } catch (err) {
        log.warn({ err, ediIdx: row.idx }, '저장소에서 EDI 이미지를 읽지 못했습니다');
      }
    }
    if (isAllowedLegacyUrl(url, deps.config.legacyImageUrlPrefixes)) {
      const got = typed(await fetchLegacy(url, log));
      if (got) return got;
    }
  }
  if (row.has_data) {
    const { rows } = await deps.db.query<{ edi_image: Buffer | null }>('SELECT edi_image FROM public.edi WHERE idx = $1', [row.idx]);
    const raw = rows[0]?.edi_image;
    if (raw) {
      const decoded = decodeEdiImage(raw);
      const got = typed(decoded);
      if (got) return got;
      // bytea 에 URL 문자열이 들어 있는 경우(드묾)
      const text = raw.subarray(0, 2048).toString('utf8').trim();
      if (/^https:\/\//i.test(text) && isAllowedLegacyUrl(text, deps.config.legacyImageUrlPrefixes)) return typed(await fetchLegacy(text, log));
    }
  }
  return null;
}

async function ediImage(deps: Deps, payload: FileTokenPayload, log: FastifyBaseLogger): Promise<ImagePayload | null> {
  if (!deps.capabilities.modules.ediLegacy) return null;
  const idx = ediIdxOf(payload.id);
  if (idx === null) return null;
  const row = await ediOwned(deps.db, deps, idx, payload.u);
  if (!row) return null;

  if (payload.v === 'full') return ediFullImage(deps, row, log);

  const url = row.aws_url?.trim() || null;
  const key = url ? deps.storage.keyFromUrl(url) : null;
  if (key) {
    const stored = await storedThumbForKey(deps, key);
    if (stored) return stored;
  }
  const cacheKey = `${row.idx}|${url ?? 'edi_image'}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const full = await ediFullImage(deps, row, log);
  if (!full) return null;
  const thumb = await toThumb(full, log);
  if (thumb.generated && thumb.payload.buffer.length <= THUMB_CACHE_MAX_BYTES) cacheSet(cacheKey, thumb.payload);
  return thumb.payload;
}

/** 토큰 payload(서명·만료 검증 완료)에 해당하는 이미지. 없거나 권한이 없으면 null */
export async function resolveFileImage(deps: Deps, payload: FileTokenPayload, log: FastifyBaseLogger): Promise<ImagePayload | null> {
  return payload.k === 'u' ? uploadImage(deps, payload, log) : ediImage(deps, payload, log);
}

/** 테스트용: 썸네일 캐시 비우기 */
export function clearThumbCache(): void {
  thumbCache.clear();
}

/** 테스트용: 썸네일 캐시 항목 수 */
export function thumbCacheSize(): number {
  return thumbCache.size;
}
