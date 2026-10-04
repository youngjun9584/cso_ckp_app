/**
 * 사진 형식 판별 (순수 함수): MIME·확장자·매직 바이트.
 * 지원: JPEG, PNG, WEBP, HEIC/HEIF (DESIGN §4). GIF·BMP·TIFF·동영상·문서 등은 지원하지 않는다.
 */

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'heic';
export type UnsupportedKind = 'gif' | 'bmp' | 'tiff' | 'avif' | 'svg' | 'pdf' | 'video' | 'other';
export type FileKind = ImageKind | UnsupportedKind;

export const SUPPORTED_KINDS: readonly ImageKind[] = ['jpeg', 'png', 'webp', 'heic'];

/** 원본 선택 파일 최대 크기 (DESIGN §4: 50MB 초과 거부) */
export const SOURCE_MAX_BYTES = 50 * 1024 * 1024;
/** 앱 처리 결과 긴 변 최대 */
export const PROCESSED_MAX_LONG_SIDE = 2560;
export const PROCESSED_JPEG_QUALITY = 0.85;
export const THUMB_LONG_SIDE = 360;
export const THUMB_JPEG_QUALITY = 0.7;

const KIND_LABEL: Record<FileKind, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WEBP',
  heic: 'HEIC',
  gif: 'GIF',
  bmp: 'BMP',
  tiff: 'TIFF',
  avif: 'AVIF',
  svg: 'SVG',
  pdf: 'PDF',
  video: '동영상',
  other: '알 수 없는 형식',
};

export function kindLabel(kind: FileKind): string {
  return KIND_LABEL[kind];
}

export function isSupportedKind(kind: FileKind | null): kind is ImageKind {
  return kind !== null && (SUPPORTED_KINDS as readonly string[]).includes(kind);
}

export function kindFromMime(mime: string | null | undefined): FileKind | null {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim();
  if (!m) return null;
  if (m === 'image/jpeg' || m === 'image/jpg' || m === 'image/pjpeg') return 'jpeg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/heic' || m === 'image/heif' || m === 'image/heic-sequence' || m === 'image/heif-sequence') return 'heic';
  if (m === 'image/gif') return 'gif';
  if (m === 'image/bmp' || m === 'image/x-ms-bmp') return 'bmp';
  if (m === 'image/tiff') return 'tiff';
  if (m === 'image/avif') return 'avif';
  if (m === 'image/svg+xml') return 'svg';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('video/')) return 'video';
  if (m === 'application/octet-stream') return null; // 알 수 없음 → 확장자·매직 바이트로 판단
  return 'other';
}

export function extensionOf(name: string | null | undefined): string {
  const clean = (name ?? '').split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (dot < 0 || dot < slash || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).toLowerCase();
}

export function kindFromExtension(name: string | null | undefined): FileKind | null {
  const ext = extensionOf(name);
  if (!ext) return null;
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'jpe' || ext === 'jfif') return 'jpeg';
  if (ext === 'png') return 'png';
  if (ext === 'webp') return 'webp';
  if (ext === 'heic' || ext === 'heif' || ext === 'hif') return 'heic';
  if (ext === 'gif') return 'gif';
  if (ext === 'bmp') return 'bmp';
  if (ext === 'tif' || ext === 'tiff') return 'tiff';
  if (ext === 'avif') return 'avif';
  if (ext === 'svg') return 'svg';
  if (ext === 'pdf') return 'pdf';
  if (['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp', 'wmv'].includes(ext)) return 'video';
  return 'other';
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const VIDEO_BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'qt  ', 'm4v ', '3gp4', '3gp5', 'avc1', 'dash']);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let s = '';
  for (let i = start; i < start + length && i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return s;
}

/** 파일 앞부분(최소 12바이트, 32바이트 권장)으로 형식 판별. 판별 불가면 null */
export function kindFromMagic(bytes: Uint8Array): FileKind | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 4) === 'GIF8') return 'gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)) {
    return 'tiff';
  }
  if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (HEIF_BRANDS.has(brand)) return 'heic';
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (VIDEO_BRANDS.has(brand)) return 'video';
    return 'other';
  }
  const head = ascii(bytes, 0, Math.min(bytes.length, 32)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
  return null;
}

export interface TypeCheck {
  kind: FileKind | null;
  supported: boolean;
  /** 지원하지 않으면 사용자에게 보여줄 이유 */
  reason: string | null;
}

export function unsupportedReason(kind: FileKind): string {
  if (kind === 'video') return '동영상은 등록할 수 없습니다. 사진만 선택해 주세요.';
  if (kind === 'other') return '지원하지 않는 형식입니다. JPG, PNG, WEBP, HEIC 사진만 등록할 수 있습니다.';
  return `지원하지 않는 형식입니다(${kindLabel(kind)}). JPG, PNG, WEBP, HEIC 사진만 등록할 수 있습니다.`;
}

/**
 * 선택 직후(파일 내용을 읽기 전) 판별: MIME 우선, 없으면 확장자.
 * 판별할 수 없으면 일단 지원으로 두고 처리 단계(매직 바이트·디코딩)에서 다시 확인한다.
 */
export function checkDeclaredType(name: string | null | undefined, mime: string | null | undefined): TypeCheck {
  const byMime = kindFromMime(mime);
  const byExt = kindFromExtension(name);
  // 일부 브라우저·기기는 HEIC 의 MIME 을 비워 두거나 octet-stream 으로 준다
  const kind = byMime && byMime !== 'other' ? byMime : (byExt ?? byMime);
  if (kind === null) return { kind: null, supported: true, reason: null };
  if (isSupportedKind(kind)) return { kind, supported: true, reason: null };
  return { kind, supported: false, reason: unsupportedReason(kind) };
}

/** 매직 바이트로 최종 확인 (판별 불가면 선언 형식을 따른다) */
export function checkContentType(magic: Uint8Array | null, declared: FileKind | null): TypeCheck {
  const byMagic = magic ? kindFromMagic(magic) : null;
  const kind = byMagic ?? declared;
  if (kind === null) return { kind: null, supported: true, reason: null };
  if (isSupportedKind(kind)) return { kind, supported: true, reason: null };
  return { kind, supported: false, reason: unsupportedReason(kind) };
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function sourceTooLargeReason(bytes: number): string {
  return `파일 크기가 50MB를 넘습니다(${megabytes(bytes)}). 더 작은 사진을 선택해 주세요.`;
}

export function processedTooLargeReason(bytes: number, maxBytes: number): string {
  return `변환한 사진이 너무 큽니다(${megabytes(bytes)}, 최대 ${megabytes(maxBytes)}). 다른 사진을 선택해 주세요.`;
}

export function tooSmallReason(longSide: number, minLongSide: number): string {
  return `사진 해상도가 너무 낮습니다(긴 변 ${longSide}px). 긴 변이 ${minLongSide}px 이상인 사진을 선택해 주세요.`;
}

export function originalTooLargeReason(bytes: number, maxBytes: number): string {
  return `기기에서 사진을 변환하지 못했고, 원본이 너무 커서(${megabytes(bytes)}, 최대 ${megabytes(maxBytes)}) 그대로 올릴 수도 없습니다. 사진을 JPG로 다시 저장하거나 다른 사진을 선택해 주세요.`;
}

/** 원본을 그대로 올릴 수 없는 이유 (null 이면 호출한 쪽의 기본 안내를 쓴다) */
export type OriginalUploadCheck = { ok: true; bytes: number } | { ok: false; reason: string | null };

/**
 * 기기에서 변환(디코딩·방향 보정·축소)에 실패한 사진을 원본 그대로 올려도 되는지 — 예: iOS 의 흑백·CMYK JPEG/PNG.
 * 서버가 매직 바이트로 형식을 다시 확인하고 회전·메타데이터 제거·축소·JPEG 재인코딩을 하므로,
 * 내용이 JPEG/PNG/WEBP 로 확인되고(매직 바이트) 서버 1장 최대 용량 이하이며 해상도가 충분하면 된다.
 */
export function originalUploadCheck(
  magicKind: FileKind | null,
  bytes: number | null,
  width: number,
  height: number,
  limits: { minLongSide: number; maxBytes: number },
): OriginalUploadCheck {
  if (magicKind !== 'jpeg' && magicKind !== 'png' && magicKind !== 'webp') return { ok: false, reason: null };
  if (bytes === null || bytes <= 0) return { ok: false, reason: null };
  if (bytes > limits.maxBytes) return { ok: false, reason: originalTooLargeReason(bytes, limits.maxBytes) };
  const longSide = Math.max(width, height);
  if (!(longSide > 0)) return { ok: false, reason: null };
  if (longSide < limits.minLongSide) return { ok: false, reason: tooSmallReason(longSide, limits.minLongSide) };
  return { ok: true, bytes };
}

/** 긴 변을 maxLongSide 이하로 (비율 유지, 확대하지 않음). 이미 작으면 null */
export function fitLongSide(width: number, height: number, maxLongSide: number): { width: number; height: number } | null {
  if (width <= 0 || height <= 0) return null;
  const long = Math.max(width, height);
  if (long <= maxLongSide) return null;
  const scale = maxLongSide / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 사진 파일 이름을 화면용으로 (경로 제거, 없으면 '사진 N') */
export function displayName(name: string | null | undefined, fallbackIndex: number): string {
  const raw = (name ?? '').split(/[?#]/)[0];
  const base = raw.slice(Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\')) + 1).trim();
  return base || `사진 ${fallbackIndex}`;
}
