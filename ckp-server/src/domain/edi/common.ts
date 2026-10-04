/**
 * EDI 공통: 스키마 준비 확인, UUID 형식, 사진 URL 서명기, aws_url 길이 한도.
 */
import type { FastifyRequest } from 'fastify';
import type { RouteDeps } from '../../app.js';
import type { Capabilities } from '../../db/schema-check.js';
import { AppError } from '../../lib/errors.js';
import type { FileTokenVariant } from '../../lib/tokens.js';
import { buildFileUrl } from '../../lib/urls.js';

export const SCHEMA_NOT_READY_MESSAGE =
  'EDI 등록에 필요한 서버 데이터베이스 준비가 완료되지 않아 이 기능을 사용할 수 없습니다. 관리자에게 문의해 주세요.';

/** 앱 전용 테이블(ckp_app_*)과 기존 edi·is_edi 테이블이 모두 있어야 EDI 업로드·제출·내역이 동작한다 */
export function ediSchemaReady(caps: Capabilities): boolean {
  return caps.ediAppTables && caps.modules.ediLegacy;
}

/** 없는 테이블 이름은 응답에 넣지 않는다(내부 정보) — 운영자는 시작 로그·npm run db:check 로 확인 */
export function assertEdiSchemaReady(caps: Capabilities): void {
  if (!ediSchemaReady(caps)) throw new AppError('SCHEMA_NOT_READY', SCHEMA_NOT_READY_MESSAGE);
}

/** 버전 무관 UUID 모양(PostgreSQL uuid 가 받는 형식). 비교를 위해 소문자로 정규화해서 쓴다 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function normalizeUuid(value: string): string {
  return value.toLowerCase();
}

/** edi.aws_url 에 기록할 수 있는 최대 길이 (DESIGN §2.5: ≤200, 실제 컬럼이 더 짧으면 그 값) */
export function awsUrlMaxLength(caps: Capabilities): number {
  const col = caps.columns.edi?.aws_url?.maxLength;
  return typeof col === 'number' && col > 0 ? Math.min(200, col) : 200;
}

/** 응답에 넣을 서명 이미지 URL 을 만든다 (요청 Host 또는 PUBLIC_BASE_URL 기준 절대 주소) */
export interface PhotoUrlSigner {
  edi(ediIdx: number, variant: FileTokenVariant): string;
  upload(uploadId: string, variant: FileTokenVariant): string;
}

export function createPhotoUrlSigner(request: FastifyRequest, deps: RouteDeps, usrId: string): PhotoUrlSigner {
  const sign = (k: 'u' | 'e', id: string | number, v: FileTokenVariant) =>
    buildFileUrl(request, deps.config, deps.tokens.signFileToken({ k, id, v, u: usrId }));
  return {
    edi: (ediIdx, variant) => sign('e', ediIdx, variant),
    upload: (uploadId, variant) => sign('u', uploadId, variant),
  };
}
