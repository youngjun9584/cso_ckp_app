/**
 * 사진 처리 — 웹 (iOS/Android 는 process.ts).
 * 형식 확인(MIME·확장자·매직 바이트) → 브라우저 디코딩(<img>, EXIF 방향 자동 적용) → 실패하고 HEIC 이면 heic2any 로 변환
 * → 캔버스에 긴 변 ≤2560 으로 한 번에 그려 JPEG 0.85 + 썸네일(긴 변 360) JPEG 0.7.
 *
 * 웹에서 expo-image-manipulator 를 쓰지 않는 이유(node_modules/expo-image-manipulator/src/web 확인):
 *  - resize 가 메인 스레드 JS 픽셀 루프(Hermite)라 12MP 사진 1장에 수 초간 화면이 멈춘다.
 *  - 원본 크기 캔버스를 만들고 renderAsync 마다 원본 크기 PNG blob URL 을 만든 뒤 해제하지 않는다(사진 30장이면 수백 MB).
 *  - 48MP 이상 사진은 iOS Safari 캔버스 최대 면적(약 16.7MP)을 넘어 실패한다.
 * 여기서는 목표 크기(≤2560) 캔버스만 만들고 축소는 브라우저 네이티브 drawImage 가 한다.
 */
import { convertHeicToJpeg } from './heic.web';
import {
  PROCESSED_JPEG_QUALITY,
  PROCESSED_MAX_LONG_SIDE,
  SOURCE_MAX_BYTES,
  THUMB_JPEG_QUALITY,
  THUMB_LONG_SIDE,
  checkContentType,
  checkDeclaredType,
  fitLongSide,
  processedTooLargeReason,
  sourceTooLargeReason,
  tooSmallReason,
} from './file-type';
import { MSG_DECODE_FAILED, MSG_HEIC_FAILED, MSG_PROCESS_FAILED, type ProcessPhotoFn } from './types';

async function readBlob(input: { blob?: Blob; uri: string }): Promise<Blob | null> {
  if (input.blob) return input.blob;
  if (!input.uri) return null;
  try {
    const res = await fetch(input.uri);
    return await res.blob();
  } catch {
    return null;
  }
}

async function readHead(blob: Blob, length = 32): Promise<Uint8Array | null> {
  try {
    const slice = blob.slice(0, length);
    if (typeof slice.arrayBuffer === 'function') return new Uint8Array(await slice.arrayBuffer());
    return await new Promise<Uint8Array | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result instanceof ArrayBuffer ? new Uint8Array(reader.result) : null);
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(slice);
    });
  } catch {
    return null;
  }
}

interface Decoded {
  image: HTMLImageElement;
  width: number;
  height: number;
  dispose: () => void;
}

/** 브라우저가 읽을 수 있으면 디코딩된 <img>, 아니면 null */
async function decodeImage(blob: Blob): Promise<Decoded | null> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  const dispose = () => {
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('decode'));
      image.src = url;
    });
    // 실제 픽셀 디코딩까지 기다린다 (지원하지 않는 브라우저는 onload 로 충분)
    if (typeof image.decode === 'function') await image.decode().catch(() => undefined);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!(width > 0 && height > 0)) {
      dispose();
      return null;
    }
    return { image, width, height, dispose };
  } catch {
    dispose();
    return null;
  }
}

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // 투명 PNG 가 JPEG 에서 검게 나오지 않도록 흰 바탕
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

/** 캔버스 메모리를 바로 돌려준다 (Safari 는 GC 전까지 잡고 있는 경우가 있음) */
function freeCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob && blob.size > 0 ? blob : null), 'image/jpeg', quality);
    } catch {
      resolve(null);
    }
  });
}

/** 큰 캔버스 → 작은 썸네일: 절반씩 줄여 글자 부분 계단 현상을 줄인다 */
function downscale(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement | null {
  let current = source;
  let cw = source.width;
  let ch = source.height;
  const temps: HTMLCanvasElement[] = [];
  while (cw / 2 >= width && ch / 2 >= height) {
    const nw = Math.max(width, Math.round(cw / 2));
    const nh = Math.max(height, Math.round(ch / 2));
    const step = createCanvas(nw, nh);
    if (!step) break;
    step.ctx.drawImage(current, 0, 0, nw, nh);
    temps.push(step.canvas);
    current = step.canvas;
    cw = nw;
    ch = nh;
  }
  const out = createCanvas(width, height);
  if (!out) {
    temps.forEach(freeCanvas);
    return null;
  }
  out.ctx.drawImage(current, 0, 0, width, height);
  temps.forEach(freeCanvas);
  return out.canvas;
}

export const processPhoto: ProcessPhotoFn = async (input, limits) => {
  if (typeof document === 'undefined') return { ok: false, reason: MSG_PROCESS_FAILED };

  const blob = await readBlob(input);
  if (!blob) return { ok: false, reason: MSG_DECODE_FAILED };
  if (blob.size > SOURCE_MAX_BYTES) return { ok: false, reason: sourceTooLargeReason(blob.size) };

  const declared = checkDeclaredType(input.name, input.mimeType || blob.type);
  const content = checkContentType(await readHead(blob), declared.kind);
  if (!content.supported) return { ok: false, reason: content.reason ?? MSG_DECODE_FAILED };

  let decoded = await decodeImage(blob);
  if (!decoded && content.kind === 'heic') {
    const jpeg = await convertHeicToJpeg(blob);
    if (!jpeg) return { ok: false, reason: MSG_HEIC_FAILED };
    decoded = await decodeImage(jpeg);
    if (!decoded) return { ok: false, reason: MSG_HEIC_FAILED };
  }
  if (!decoded) return { ok: false, reason: MSG_DECODE_FAILED };

  let main: HTMLCanvasElement | null = null;
  let thumb: HTMLCanvasElement | null = null;
  try {
    const { width, height } = decoded;
    const longSide = Math.max(width, height);
    if (longSide < limits.minLongSide) return { ok: false, reason: tooSmallReason(longSide, limits.minLongSide) };

    const target = fitLongSide(width, height, PROCESSED_MAX_LONG_SIDE) ?? { width, height };
    const created = createCanvas(target.width, target.height);
    if (!created) return { ok: false, reason: MSG_PROCESS_FAILED };
    main = created.canvas;
    created.ctx.drawImage(decoded.image, 0, 0, target.width, target.height);
    // 원본 디코딩 메모리는 바로 놓는다
    decoded.dispose();

    const jpeg = await canvasToJpeg(main, PROCESSED_JPEG_QUALITY);
    if (!jpeg) return { ok: false, reason: MSG_PROCESS_FAILED };
    if (jpeg.size > limits.maxBytes) return { ok: false, reason: processedTooLargeReason(jpeg.size, limits.maxBytes) };

    const thumbSize = fitLongSide(target.width, target.height, THUMB_LONG_SIDE) ?? target;
    thumb = downscale(main, thumbSize.width, thumbSize.height);
    const thumbBlob = thumb ? await canvasToJpeg(thumb, THUMB_JPEG_QUALITY) : null;

    const uri = URL.createObjectURL(jpeg);
    const thumbUri = thumbBlob ? URL.createObjectURL(thumbBlob) : uri;
    return {
      ok: true,
      processed: { uri, width: target.width, height: target.height, bytes: jpeg.size, thumbUri },
    };
  } catch {
    return { ok: false, reason: MSG_PROCESS_FAILED };
  } finally {
    decoded.dispose();
    freeCanvas(main);
    freeCanvas(thumb);
  }
};
