/**
 * 사진 처리 — iOS/Android (웹은 process.web.ts, 같은 ProcessPhotoFn 모양).
 * 형식 확인(MIME·확장자·매직 바이트) → expo-image-manipulator 로 디코딩(OS 디코더: HEIC 포함, EXIF 방향 보정)
 * → 긴 변 2560 초과 시 축소(비율 유지, 확대 없음) → JPEG 0.85 저장 + 긴 변 360 썸네일 JPEG 0.7.
 *
 * API(v57, node_modules/expo-image-manipulator/build 확인):
 *   ImageManipulator.manipulate(uri | ImageRef) → context.resize({width}|{height}) → await context.renderAsync() → ImageRef
 *   ImageRef.saveAsync({ format: SaveFormat.JPEG, compress }) → { uri, width, height }
 * 같은 context 에 renderAsync 뒤 resize 를 추가하면 이미 불러온 이미지에 이어서 적용된다(iOS/Android 구현 확인).
 * 그래서 먼저 한 번 그려 실제(방향 보정된) 크기를 알아낸 뒤 필요할 때만 축소한다 — 다시 디코딩하지 않는다.
 *
 * 변환 실패 시 원본 그대로 올리기: iOS 의 expo-image-manipulator 는 흑백(1채널)·CMYK 사진에서 방향 보정용 그리기 영역을
 * 만들지 못해 항상 실패한다(ImageFixOrientationTransformer). 내용이 JPEG/PNG/WEBP 이고 서버 1장 최대 용량 이하이면
 * 원본(선택기 복사본)을 처리본·썸네일로 그대로 쓴다 — 서버가 회전·메타데이터 제거·축소·JPEG 재인코딩을 한다.
 */
import { File, FileMode } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

import { deleteQuietly } from './cleanup';
import {
  PROCESSED_JPEG_QUALITY,
  PROCESSED_MAX_LONG_SIDE,
  SOURCE_MAX_BYTES,
  THUMB_JPEG_QUALITY,
  THUMB_LONG_SIDE,
  checkContentType,
  checkDeclaredType,
  fitLongSide,
  kindFromMagic,
  originalUploadCheck,
  processedTooLargeReason,
  sourceTooLargeReason,
  tooSmallReason,
  type FileKind,
} from './file-type';
import { MSG_DECODE_FAILED, MSG_HEIC_FAILED, MSG_PROCESS_FAILED, type ProcessInput, type ProcessLimits, type ProcessPhotoFn, type ProcessResult } from './types';

interface Releasable {
  release(): void;
}

function releaseAll(items: (Releasable | null | undefined)[]): void {
  for (const item of items) {
    try {
      item?.release();
    } catch {
      // 이미 해제됨
    }
  }
}

function openFile(uri: string): File | null {
  try {
    return new File(uri);
  } catch {
    return null;
  }
}

function fileSize(file: File | null): number | null {
  try {
    const size = file?.size;
    return typeof size === 'number' && size >= 0 ? size : null;
  } catch {
    return null;
  }
}

/** 파일 앞 32바이트 (읽을 수 없으면 null → 선언 형식·디코딩 결과로 판단) */
function readMagic(file: File | null): Uint8Array | null {
  if (!file) return null;
  let handle: ReturnType<File['open']> | null = null;
  try {
    handle = file.open(FileMode.ReadOnly);
    return handle.readBytes(32);
  } catch {
    return null;
  } finally {
    try {
      handle?.close();
    } catch {
      // 무시
    }
  }
}

/**
 * 기기에서 변환하지 못했을 때: 올릴 수 있는 원본이면 원본을 처리본·썸네일로 그대로 쓰고, 아니면 이유와 함께 처리 불가.
 * (width/height 는 선택기가 알려 준 방향 반영 크기 — 서버가 실제 크기를 다시 읽는다)
 */
function originalOrInvalid(
  input: ProcessInput,
  limits: ProcessLimits,
  magicKind: FileKind | null,
  size: number | null,
  defaultReason: string,
): ProcessResult {
  const check = originalUploadCheck(magicKind, size, input.width, input.height, limits);
  if (!check.ok) return { ok: false, reason: check.reason ?? defaultReason };
  return { ok: true, processed: { uri: input.uri, width: input.width, height: input.height, bytes: check.bytes, thumbUri: input.uri } };
}

export const processPhoto: ProcessPhotoFn = async (input, limits) => {
  const source = openFile(input.uri);

  const size = input.size ?? fileSize(source);
  if (size !== null && size > SOURCE_MAX_BYTES) return { ok: false, reason: sourceTooLargeReason(size) };

  const declared = checkDeclaredType(input.name, input.mimeType);
  const magic = readMagic(source);
  const magicKind = magic ? kindFromMagic(magic) : null;
  const content = checkContentType(magic, declared.kind);
  if (!content.supported) return { ok: false, reason: content.reason ?? MSG_DECODE_FAILED };

  let context: ReturnType<typeof ImageManipulator.manipulate> | null = null;
  let base: ImageRef | null = null;
  let resized: ImageRef | null = null;
  let thumbContext: Releasable | null = null;
  let thumbRef: ImageRef | null = null;
  try {
    try {
      context = ImageManipulator.manipulate(input.uri);
      base = await context.renderAsync();
    } catch {
      // 예: iOS 흑백·CMYK 사진 → 원본을 그대로 올린다 (HEIC 는 서버가 변환할 수 없어 제외)
      return originalOrInvalid(input, limits, magicKind, size, content.kind === 'heic' ? MSG_HEIC_FAILED : MSG_DECODE_FAILED);
    }

    const width = base.width;
    const height = base.height;
    if (!(width > 0 && height > 0)) return { ok: false, reason: MSG_DECODE_FAILED };
    const longSide = Math.max(width, height);
    if (longSide < limits.minLongSide) return { ok: false, reason: tooSmallReason(longSide, limits.minLongSide) };

    let output: ImageRef = base;
    const fit = fitLongSide(width, height, PROCESSED_MAX_LONG_SIDE);
    if (fit) {
      // 한 변만 지정하면 비율이 유지된다
      context.resize(width >= height ? { width: fit.width } : { height: fit.height });
      resized = await context.renderAsync();
      output = resized;
    }

    const saved = await output.saveAsync({ format: SaveFormat.JPEG, compress: PROCESSED_JPEG_QUALITY });
    const bytes = fileSize(openFile(saved.uri)) ?? 0;
    if (bytes > limits.maxBytes) {
      deleteQuietly(saved.uri);
      return { ok: false, reason: processedTooLargeReason(bytes, limits.maxBytes) };
    }

    let thumbUri = saved.uri;
    try {
      const tctx = ImageManipulator.manipulate(output);
      thumbContext = tctx;
      const thumbFit = fitLongSide(output.width, output.height, THUMB_LONG_SIDE);
      if (thumbFit) tctx.resize(output.width >= output.height ? { width: thumbFit.width } : { height: thumbFit.height });
      thumbRef = await tctx.renderAsync();
      const thumb = await thumbRef.saveAsync({ format: SaveFormat.JPEG, compress: THUMB_JPEG_QUALITY });
      thumbUri = thumb.uri;
    } catch {
      // 썸네일만 실패하면 처리본을 쓴다 (expo-image 가 표시 크기로 줄여 디코딩한다)
    }

    return {
      ok: true,
      processed: { uri: saved.uri, width: saved.width, height: saved.height, bytes, thumbUri },
    };
  } catch {
    // 축소·저장 단계 실패(저장 공간 부족 등)도 올릴 수 있는 원본이면 원본으로 대신한다
    return originalOrInvalid(input, limits, magicKind, size, MSG_PROCESS_FAILED);
  } finally {
    releaseAll([thumbRef, thumbContext, resized, base, context]);
  }
};
