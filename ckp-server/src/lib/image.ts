/**
 * EDI 사진 처리 (sharp)
 *
 *  sniffImageType(buf)          매직 바이트로 형식 판별 (jpeg/png/webp 허용, heic/avif/gif/bmp/tiff 는 감지만)
 *  readImageMeta(buf)           크기·방향 등 메타 (디코드 실패 → AppError IMAGE_DECODE_FAILED)
 *  normalizeImage(buf, meta)    JPEG + 방향 1/없음 + 긴 변 ≤ 3200 → 메타 세그먼트만 무손실 제거
 *                               그 외 → rotate() + 축소(3200) + JPEG q88 재인코딩
 *  makeThumbnail(buf)           긴 변 480 JPEG q72
 *  processPhoto(buf, limits)    위 단계를 모두 수행하고 오류를 AppError(415/422)로 변환 — EDI 업로드 라우트용
 *  stripJpegMetadata(buf)       APP1(EXIF/XMP)·APP13(IPTC) 등 제거, SOI~EOI 이후 꼬리 데이터 제거
 */
import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { AppError } from './errors.js';

export type SniffedType = 'jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'gif' | 'bmp' | 'tiff';

export const ACCEPTED_TYPES: ReadonlyArray<SniffedType> = ['jpeg', 'png', 'webp'];
export const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const NORMALIZE_MAX_LONG_SIDE = 3200;
export const NORMALIZE_JPEG_QUALITY = 88;
export const THUMB_LONG_SIDE = 480;
export const THUMB_JPEG_QUALITY = 72;
/** 압축 폭탄 방지: 입력 최대 픽셀 수 (약 1억 화소) */
export const MAX_INPUT_PIXELS = 100_000_000;

export const HEIC_MESSAGE = 'HEIC 형식은 서버에서 변환할 수 없습니다. 앱에서 JPG로 변환해 다시 올려 주세요.';

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** 파일 앞부분의 매직 바이트로 형식을 판별한다. 알 수 없으면 null */
export function sniffImageType(buf: Buffer): SniffedType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const major = buf.toString('ascii', 8, 12).toLowerCase();
    const brands = [major];
    const boxSize = buf.readUInt32BE(0);
    for (let off = 16; off + 4 <= Math.min(boxSize, buf.length, 64); off += 4) brands.push(buf.toString('ascii', off, off + 4).toLowerCase());
    if (brands.some((b) => AVIF_BRANDS.has(b))) return 'avif';
    if (brands.some((b) => HEIF_BRANDS.has(b))) return 'heic';
    return null;
  }
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) || (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)) {
    return 'tiff';
  }
  return null;
}

export interface ImageMeta {
  format: 'jpeg' | 'png' | 'webp';
  /** 저장된 픽셀 크기(회전 전) */
  width: number;
  height: number;
  /** EXIF 방향을 적용했을 때 보이는 크기 */
  displayWidth: number;
  displayHeight: number;
  /** EXIF orientation 1..8 (없으면 undefined) */
  orientation?: number;
  hasAlpha: boolean;
}

function sharpInput(buf: Buffer) {
  return sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
}

/** 메타데이터를 읽는다. 허용 형식(jpeg/png/webp)이 아니거나 디코드 실패 시 AppError */
export async function readImageMeta(buf: Buffer): Promise<ImageMeta> {
  let meta: Metadata;
  try {
    meta = await sharpInput(buf).metadata();
  } catch (err) {
    throw new AppError('IMAGE_DECODE_FAILED', undefined, { cause: err });
  }
  const format = meta.format === 'jpeg' || meta.format === 'png' || meta.format === 'webp' ? meta.format : null;
  if (!format) throw new AppError('UNSUPPORTED_FILE_TYPE');
  if (!meta.width || !meta.height) throw new AppError('IMAGE_DECODE_FAILED');
  const swap = meta.orientation !== undefined && meta.orientation >= 5 && meta.orientation <= 8;
  const result: ImageMeta = {
    format,
    width: meta.width,
    height: meta.height,
    displayWidth: swap ? meta.height : meta.width,
    displayHeight: swap ? meta.width : meta.height,
    hasAlpha: meta.hasAlpha === true,
  };
  if (meta.orientation !== undefined) result.orientation = meta.orientation;
  return result;
}

// ─────────────────────── JPEG 무손실 메타 제거 ───────────────────────

/**
 * JPEG 마커를 따라가며 메타 세그먼트를 제거한다(픽셀 데이터는 그대로).
 *  제거: APP1(EXIF/XMP, GPS 포함), APP3~APP13(IPTC 등), APP15, COM, APP2 의 MPF(보조 이미지 색인)
 *  유지: APP0(JFIF), APP2 ICC_PROFILE(색 재현), APP14(Adobe, 색 변환 정보)
 *  EOI 이후 꼬리 데이터(보조 이미지 등)는 버린다.
 * 구조가 이상하면 null 을 반환한다(호출 측에서 재인코딩으로 대체).
 */
export function stripJpegMetadata(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  let inScan = false;
  while (i < buf.length) {
    if (inScan) {
      // 엔트로피 코딩 데이터: 다음 마커(FF xx, xx ∉ {00, D0..D7, FF})까지 복사
      const start = i;
      while (i < buf.length) {
        if (buf[i] === 0xff && i + 1 < buf.length) {
          const n = buf[i + 1] as number;
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
            i += 2;
            continue;
          }
          if (n === 0xff) {
            i += 1;
            continue;
          }
          break;
        }
        i += 1;
      }
      out.push(buf.subarray(start, i));
      if (i >= buf.length) return null; // EOI 없이 끝남
      inScan = false;
      continue;
    }
    if (buf[i] !== 0xff) return null;
    // 채움 바이트(FF FF ...) 건너뛰기
    while (i + 1 < buf.length && buf[i + 1] === 0xff) i += 1;
    if (i + 1 >= buf.length) return null;
    const marker = buf[i + 1] as number;
    if (marker === 0xd9) {
      out.push(buf.subarray(i, i + 2)); // EOI
      return Buffer.concat(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    const segEnd = i + 2 + len;
    const payload = buf.subarray(i + 4, segEnd);
    let keep = true;
    if (marker === 0xe1 || (marker >= 0xe3 && marker <= 0xed) || marker === 0xef || marker === 0xfe) keep = false;
    if (marker === 0xe2) keep = payload.toString('latin1', 0, 12) === 'ICC_PROFILE\0';
    if (keep) out.push(buf.subarray(i, segEnd));
    i = segEnd;
    if (marker === 0xda) inScan = true; // SOS 다음은 엔트로피 데이터
  }
  return null;
}

// ─────────────────────── 정규화 · 썸네일 ───────────────────────

export interface NormalizedImage {
  buffer: Buffer;
  contentType: 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
  /** lossless-strip: 원본 JPEG 픽셀 유지 + 메타 제거 / reencode: 회전·축소·재인코딩 */
  strategy: 'lossless-strip' | 'reencode';
}

export interface NormalizeOptions {
  maxLongSide?: number;
  quality?: number;
}

async function reencode(buf: Buffer, maxLongSide: number, quality: number): Promise<NormalizedImage> {
  const { data, info } = await sharpInput(buf)
    .rotate() // EXIF 방향 적용 (출력에는 메타데이터가 남지 않음)
    .resize({ width: maxLongSide, height: maxLongSide, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, chromaSubsampling: '4:2:0', mozjpeg: false })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, contentType: 'image/jpeg', width: info.width, height: info.height, bytes: data.length, strategy: 'reencode' };
}

/** EDI 저장용 정규화 JPEG 을 만든다. meta 를 넘기면 다시 읽지 않는다. */
export async function normalizeImage(buf: Buffer, meta?: ImageMeta, opts: NormalizeOptions = {}): Promise<NormalizedImage> {
  const maxLongSide = opts.maxLongSide ?? NORMALIZE_MAX_LONG_SIDE;
  const quality = opts.quality ?? NORMALIZE_JPEG_QUALITY;
  const m = meta ?? (await readImageMeta(buf));
  const longSide = Math.max(m.width, m.height);
  const upright = m.orientation === undefined || m.orientation === 1;
  if (m.format === 'jpeg' && upright && longSide <= maxLongSide) {
    const stripped = stripJpegMetadata(buf);
    if (stripped) {
      try {
        const check = await sharpInput(stripped).metadata();
        if (check.width === m.width && check.height === m.height) {
          return { buffer: stripped, contentType: 'image/jpeg', width: m.width, height: m.height, bytes: stripped.length, strategy: 'lossless-strip' };
        }
      } catch {
        // 아래에서 재인코딩
      }
    }
  }
  return reencode(buf, maxLongSide, quality);
}

export interface Thumbnail {
  buffer: Buffer;
  contentType: 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
}

export async function makeThumbnail(buf: Buffer, longSide = THUMB_LONG_SIDE, quality = THUMB_JPEG_QUALITY): Promise<Thumbnail> {
  const { data, info } = await sharpInput(buf)
    .rotate()
    .resize({ width: longSide, height: longSide, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, contentType: 'image/jpeg', width: info.width, height: info.height, bytes: data.length };
}

/** 느슨한 썸네일용 입력 한도: 약 3억 화소 (JPEG 은 축소 디코드라 1억 화소 이상도 가볍게 처리된다) */
export const LENIENT_MAX_INPUT_PIXELS = 300_000_000;

/**
 * 조회용 썸네일(이전 방식·관리자 crop 이미지) 재시도: 화소 한도를 넓히고 손상(잘린 JPEG 등)을 무시한다.
 * 업로드 검증(processPhoto)에는 절대 쓰지 않는다 — 저장 전 검증은 항상 엄격하게.
 */
export async function makeThumbnailLenient(buf: Buffer, longSide = THUMB_LONG_SIDE, quality = THUMB_JPEG_QUALITY): Promise<Thumbnail> {
  const { data, info } = await sharp(buf, { limitInputPixels: LENIENT_MAX_INPUT_PIXELS, failOn: 'none' })
    .rotate()
    .resize({ width: longSide, height: longSide, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, contentType: 'image/jpeg', width: info.width, height: info.height, bytes: data.length };
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// ─────────────────────── 업로드 파이프라인 ───────────────────────

export interface PhotoLimits {
  /** 긴 변 최소 픽셀 (config.photo.minLongSide) */
  minLongSide: number;
  maxLongSide?: number;
}

export interface ProcessedPhoto {
  sourceType: 'jpeg' | 'png' | 'webp';
  meta: ImageMeta;
  image: NormalizedImage;
  thumb: Thumbnail;
  /** 정규화 결과(image.buffer)의 sha256 */
  sha256: string;
}

/**
 * 업로드된 바이트를 검증·정규화한다. 오류는 모두 사용자 메시지가 있는 AppError:
 *  415 UNSUPPORTED_FILE_TYPE (HEIC 는 전용 안내) / 422 IMAGE_DECODE_FAILED / 422 IMAGE_TOO_SMALL
 * (용량 초과 413 은 multipart 수신 단계에서 처리된다)
 */
export async function processPhoto(buf: Buffer, limits: PhotoLimits): Promise<ProcessedPhoto> {
  const sniffed = sniffImageType(buf);
  if (sniffed === 'heic') throw new AppError('UNSUPPORTED_FILE_TYPE', HEIC_MESSAGE, { details: { detected: 'heic' } });
  if (sniffed === null || !ACCEPTED_TYPES.includes(sniffed)) {
    throw new AppError('UNSUPPORTED_FILE_TYPE', undefined, { details: { detected: sniffed ?? 'unknown' } });
  }
  const meta = await readImageMeta(buf);
  if (meta.format !== sniffed) throw new AppError('IMAGE_DECODE_FAILED');
  const longSide = Math.max(meta.width, meta.height);
  if (longSide < limits.minLongSide) {
    throw new AppError('IMAGE_TOO_SMALL', `사진 해상도가 너무 낮습니다. 긴 변이 ${limits.minLongSide}px 이상인 사진을 올려 주세요.`, {
      details: { width: meta.displayWidth, height: meta.displayHeight, minLongSide: limits.minLongSide },
    });
  }
  let image: NormalizedImage;
  let thumb: Thumbnail;
  try {
    image = await normalizeImage(buf, meta, limits.maxLongSide !== undefined ? { maxLongSide: limits.maxLongSide } : {});
    thumb = await makeThumbnail(image.buffer);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('IMAGE_DECODE_FAILED', undefined, { cause: err });
  }
  return { sourceType: sniffed, meta, image, thumb, sha256: sha256Hex(image.buffer) };
}
